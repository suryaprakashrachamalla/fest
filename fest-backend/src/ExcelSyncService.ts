import { google, type sheets_v4 } from "googleapis";
import {
    Prisma,
    type Event,
    type Participant,
    type PaymentProof,
    type Registration,
    type SpreadsheetEntityType,
} from "./generated/prisma/client.ts";
import { prisma } from "./lib/prisma.ts";
import {
    participantRow,
    registrationSheetRow,
    registrationSyncInclude,
} from "./lib/registrationSync.ts";
import {
    coalesceUpdates,
    eventTabTitle,
    findRemovableRows,
    findRenamedTab,
    headersArePrefix,
    isTransientSheetsFailure,
    planSheetRows,
} from "./lib/sheetsSyncLogic.ts";

type SheetDefinition = {
    title: string;
    entityType: SpreadsheetEntityType;
    idColumn: string;
    headers: string[];
};

type OutboxItem = {
    id: string;
    entityType: SpreadsheetEntityType;
    entityId: string;
    operation: "UPSERT";
    payload: Prisma.JsonValue;
    attempts: number;
    createdAt: Date;
};

type CoalescedItem = {
    entityType: SpreadsheetEntityType;
    entityId: string;
    payload: Record<string, unknown>;
    outboxIds: string[];
};

const definitions: SheetDefinition[] = [
    {
        title: "Events",
        entityType: "EVENT",
        idColumn: "eventId",
        headers: [
            "eventId",
            "name",
            "slug",
            "description",
            "feePaise",
            "feeMode",
            "minTeamSize",
            "maxTeamSize",
            "isPublished",
            "createdAt",
            "updatedAt",
        ],
    },
    {
        title: "Registrations",
        entityType: "REGISTRATION",
        idColumn: "registrationId",
        // Keyed by the human-friendly registration code; see registrationSheetRow.
        headers: [
            "registrationId",
            "internalId",
            "participantNames",
            "emails",
            "phone",
            "college",
            "event",
            "teamName",
            "teamSize",
            "registrationFee",
            "paymentMethod",
            "utr",
            "paymentStatus",
            "approvalStatus",
            "status",
            "rejectionReason",
            "paymentVerifiedBy",
            "paymentVerifiedAt",
            "approvedBy",
            "approvedAt",
            "rejectedBy",
            "registeredAt",
            "lumaGuestId",
            "ticketStatus",
            "emailStatus",
            "checkedIn",
            "checkedInAt",
            "updatedAt",
            // Added with the per-event tabs; older sheets get it appended automatically.
            "rollNumbers",
            "teamCode",
            "discount",
        ],
    },
    {
        title: "Participants",
        entityType: "PARTICIPANT",
        idColumn: "participantId",
        headers: [
            "participantId",
            "registrationId",
            "participantName",
            "email",
            "college",
            "rollNumber",
            "createdAt",
            // Added with entry tickets; older sheets get these appended automatically.
            "ticketEmailStatus",
            "ticketEmailedAt",
            "checkedInAt",
        ],
    },
    {
        title: "PaymentProofs",
        entityType: "PAYMENT_PROOF",
        idColumn: "proofId",
        headers: [
            "proofId",
            "registrationId",
            "utr",
            "paymentMethod",
            "screenshotMimeType",
            "status",
            "reviewedById",
            "reviewedAt",
            "rejectionReason",
            "submittedAt",
            "screenshotReference",
        ],
    },
    {
        title: "Users",
        entityType: "USER",
        idColumn: "userId",
        headers: ["userId", "name", "email", "role", "createdAt", "updatedAt"],
    },
];

// Each event also gets its own tab (named after the event) listing just its registrations, one row
// per registration. Rows come from the same REGISTRATION outbox items as the Registrations tab.
const eventTabHeaders = [
    "registrationId",
    "teamName",
    "teamSize",
    "participantNames",
    "emails",
    "rollNumbers",
    "phone",
    "college",
    "registrationFee",
    "utr",
    "paymentStatus",
    "approvalStatus",
    "ticketStatus",
    "emailStatus",
    "checkedIn",
    "checkedInAt",
    "registeredAt",
    "updatedAt",
    "teamCode",
    "discount",
];
const sharedTitles = definitions.map((definition) => definition.title);

function eventTab(eventName: string): SheetDefinition & { eventName: string } {
    return {
        title: eventTabTitle(eventName, sharedTitles),
        entityType: "REGISTRATION",
        idColumn: "registrationId",
        headers: eventTabHeaders,
        eventName,
    };
}

// Tabs known to exist with the right header row; refreshed by every full reconciliation.
const preparedTabs = new Set<string>();
// Wanted tab title -> the title organizers renamed it to in the spreadsheet.
const tabAliases = new Map<string, string>();

function sheetTitle(definition: SheetDefinition) {
    return tabAliases.get(definition.title) ?? definition.title;
}

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const batchSize = Math.max(1, Number(process.env.SHEETS_BATCH_SIZE ?? 100));
const pollIntervalMs = Math.max(1000, Number(process.env.SHEETS_POLL_INTERVAL_MS ?? 5000));
const retryBaseMs = Math.max(500, Number(process.env.SHEETS_RETRY_BASE_MS ?? 2000));
const retryMaxMs = Math.max(retryBaseMs, Number(process.env.SHEETS_RETRY_MAX_MS ?? 300000));
const reconcileIntervalMs = Math.max(
    60_000,
    Number(process.env.SHEETS_RECONCILE_INTERVAL_MS ?? 3_600_000),
);

let sheetsClient: sheets_v4.Sheets | null = null;
let lastReconciliation: {
    at: string;
    queued: number;
    refreshed: number;
    missing: number;
    stale: number;
    duplicateRows: number;
} | null = null;
let lastWorkerError: string | null = null;

function hasConfiguration() {
    return Boolean(
        spreadsheetId?.trim() &&
            process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
            process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim(),
    );
}

function getSheetsClient() {
    if (!hasConfiguration()) {
        throw Object.assign(new Error("Google Sheets credentials are not configured"), {
            status: 503, expose: true, notConfigured: true,
        });
    }
    if (sheetsClient) return sheetsClient;

    const auth = new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    return sheetsClient;
}

// Tests use an in-memory spreadsheet instead of Google's API.
export function setSheetsClientForTests(client: sheets_v4.Sheets | null) {
    sheetsClient = client;
    preparedTabs.clear();
    tabAliases.clear();
}

function columnName(columnNumber: number) {
    let current = columnNumber;
    let result = "";
    while (current > 0) {
        const remainder = (current - 1) % 26;
        result = String.fromCharCode(65 + remainder) + result;
        current = Math.floor((current - 1) / 26);
    }
    return result;
}

function quoteSheet(title: string) {
    return `'${title.replace(/'/g, "''")}'`;
}

function comparableCell(value: unknown) {
    if (value === undefined || value === null) return "";
    return String(value);
}

function toCells(definition: SheetDefinition, payload: Record<string, unknown>) {
    return definition.headers.map((header) => {
        const value = payload[header];
        if (value === undefined || value === null) return "";
        if (typeof value === "object") return JSON.stringify(value);
        return value;
    });
}

function rowsMatch(expected: unknown[], actual: unknown[]) {
    return expected.every((value, index) => comparableCell(value) === comparableCell(actual[index]));
}

// Creates any missing tabs and writes or extends their header rows.
async function prepareWorksheets(tabs: SheetDefinition[]) {
    const sheetsApi = getSheetsClient();
    const spreadsheet = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
    });
    const titles = (spreadsheet.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "");
    const existingTitles = new Set(titles);
    // Follow tabs that were renamed in the spreadsheet instead of creating a second copy.
    const claimed = new Set(
        titles.filter(
            (title) =>
                sharedTitles.includes(title) ||
                tabs.some((definition) => definition.title === title) ||
                [...tabAliases.values()].includes(title),
        ),
    );
    for (const definition of tabs) {
        tabAliases.delete(definition.title);
        if (existingTitles.has(definition.title)) continue;
        const renamed = findRenamedTab(definition.title, titles, claimed);
        if (renamed) {
            tabAliases.set(definition.title, renamed);
            claimed.add(renamed);
        }
    }
    const missingSheets = tabs.filter((definition) => !existingTitles.has(sheetTitle(definition)));

    if (missingSheets.length > 0) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: missingSheets.map((definition) => ({
                    addSheet: { properties: { title: definition.title } },
                })),
            },
        });
    }

    const headerRanges = tabs.map(
        (definition) =>
            `${quoteSheet(sheetTitle(definition))}!A1:${columnName(definition.headers.length)}1`,
    );
    const headerResult = await sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: headerRanges,
        valueRenderOption: "UNFORMATTED_VALUE",
    });
    const headerWrites: sheets_v4.Schema$ValueRange[] = [];

    tabs.forEach((definition, index) => {
        const values = headerResult.data.valueRanges?.[index]?.values?.[0] ?? [];
        if (values.length === 0 || values.every((value) => value === "")) {
            headerWrites.push({
                range: headerRanges[index],
                values: [definition.headers],
            });
            return;
        }
        if (!rowsMatch(definition.headers, values)) {
            // New columns are only ever appended, so a sheet with the older, shorter header row is extended.
            if (headersArePrefix(values, definition.headers)) {
                headerWrites.push({ range: headerRanges[index], values: [definition.headers] });
                return;
            }
            throw new Error(
                `Worksheet ${sheetTitle(definition)} has unexpected headers. Expected: ${definition.headers.join(", ")}`,
            );
        }
    });

    if (headerWrites.length > 0) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: "RAW", data: headerWrites },
        });
    }
    for (const definition of tabs) preparedTabs.add(definition.title);
}

// Whole tabs, every column: rows written out of place must be seen to be cleaned up, and new rows
// go below the last row that has anything in it.
async function readRows(definitionsToRead: SheetDefinition[]) {
    const sheetsApi = getSheetsClient();
    const response = await sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: definitionsToRead.map((definition) => quoteSheet(sheetTitle(definition))),
        valueRenderOption: "UNFORMATTED_VALUE",
    });
    return response.data.valueRanges ?? [];
}

// Tab title -> its numeric sheet ID and current number of grid rows.
async function tabLayout() {
    const spreadsheet = await getSheetsClient().spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title,gridProperties(rowCount)))",
    });
    return new Map(
        (spreadsheet.data.sheets ?? []).map((sheet) => [
            sheet.properties?.title ?? "",
            { sheetId: sheet.properties?.sheetId ?? 0, rowCount: sheet.properties?.gridProperties?.rowCount ?? 0 },
        ]),
    );
}

// Removes duplicate and misplaced rows the sync wrote earlier (see findRemovableRows). Returns
// how many rows were removed; the caller re-reads the tabs when that is not zero.
async function removeStrayRows(tabs: SheetDefinition[], valueRanges: sheets_v4.Schema$ValueRange[]) {
    const layout = await tabLayout();
    const requests: sheets_v4.Schema$Request[] = [];
    tabs.forEach((definition, index) => {
        const rows = valueRanges[index]?.values ?? [];
        const sheetId = layout.get(sheetTitle(definition))?.sheetId;
        if (sheetId === undefined) return;
        const idIndex = definition.headers.indexOf(definition.idColumn);
        for (const rowNumber of findRemovableRows(rows, idIndex, definition.headers.length)) {
            requests.push({
                deleteDimension: {
                    range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
                },
            });
        }
    });
    if (requests.length > 0) {
        await getSheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
        console.log(`Google Sheets: removed ${requests.length} duplicate or misplaced row(s)`);
    }
    return requests.length;
}

// One writer at a time across every running backend (two run side by side during a deploy), so
// rows are never placed or removed from a stale view of the sheet.
async function withSheetWriteLock<T>(work: () => Promise<T>) {
    return prisma.$transaction(
        async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('google-sheets-writer', 0))`;
            return work();
        },
        { maxWait: 120_000, timeout: 600_000 },
    );
}

async function sendSheetBatch(items: CoalescedItem[]) {
    const itemsForSheet = items.filter(
        (item) => !(item.entityType === "USER" && item.payload.role === "ADMIN"),
    );
    if (itemsForSheet.length === 0) return;

    // Registration changes also land in their event's own tab.
    const eventNames = new Set(
        itemsForSheet
            .filter((item) => item.entityType === "REGISTRATION" && typeof item.payload.event === "string")
            .map((item) => item.payload.event as string),
    );
    const eventTabs = [...eventNames].map(eventTab);
    const touchedDefinitions: Array<SheetDefinition & { eventName?: string }> = [
        ...definitions.filter((definition) =>
            itemsForSheet.some((item) => item.entityType === definition.entityType),
        ),
        ...eventTabs,
    ];
    // Shared tabs too: after a failed batch (e.g. a tab renamed or deleted in the spreadsheet) every
    // tab is looked up again, followed if renamed, or recreated.
    const unpreparedTabs = touchedDefinitions.filter((tab) => !preparedTabs.has(tab.title));
    if (unpreparedTabs.length > 0) await prepareWorksheets(unpreparedTabs);
    let currentRows = await readRows(touchedDefinitions);
    if (await removeStrayRows(touchedDefinitions, currentRows)) currentRows = await readRows(touchedDefinitions);
    const updates: sheets_v4.Schema$ValueRange[] = [];
    const appendRows = new Map<string, { definition: SheetDefinition; rows: unknown[][]; firstRow: number }>();

    touchedDefinitions.forEach((definition, definitionIndex) => {
        const rows = currentRows[definitionIndex]?.values ?? [];
        const sheetItems = itemsForSheet.filter(
            (item) =>
                item.entityType === definition.entityType &&
                (definition.eventName === undefined || item.payload.event === definition.eventName),
        );
        const plan = planSheetRows(
            definition.idColumn,
            definition.headers,
            sheetItems,
            rows,
        );
        const lastColumn = columnName(definition.headers.length);
        updates.push(
            ...plan.updates.map(({ rowNumber, values }) => ({
                range: `${quoteSheet(sheetTitle(definition))}!A${rowNumber}:${lastColumn}${rowNumber}`,
                values: [values],
            })),
        );
        // New rows go right below the last used row, starting at column A. (Sheets' own "append"
        // guesses where the table ends and has placed rows several columns to the right.)
        if (plan.appendRows.length > 0)
            appendRows.set(definition.title, { definition, rows: plan.appendRows, firstRow: Math.max(rows.length, 1) + 1 });
    });

    const sheetsApi = getSheetsClient();
    if (appendRows.size > 0) {
        const layout = await tabLayout();
        const growRequests: sheets_v4.Schema$Request[] = [];
        for (const { definition, rows, firstRow } of appendRows.values()) {
            const lastRow = firstRow + rows.length - 1;
            const tab = layout.get(sheetTitle(definition));
            if (tab && tab.rowCount < lastRow) {
                growRequests.push({
                    appendDimension: { sheetId: tab.sheetId, dimension: "ROWS", length: lastRow - tab.rowCount },
                });
            }
            updates.push({
                range: `${quoteSheet(sheetTitle(definition))}!A${firstRow}:${columnName(definition.headers.length)}${lastRow}`,
                values: rows,
            });
        }
        if (growRequests.length > 0) {
            await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: growRequests } });
        }
    }
    if (updates.length > 0) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: "RAW", data: updates },
        });
    }
}

async function claimBatch(): Promise<OutboxItem[]> {
    return prisma.$transaction(async (tx) => {
        await tx.spreadsheetSyncOutbox.updateMany({
            where: {
                status: "PROCESSING",
                processedAt: { lte: new Date(Date.now() - 10 * 60_000) },
            },
            data: { status: "PENDING", processedAt: null, nextAttemptAt: new Date() },
        });

        return tx.$queryRaw<OutboxItem[]>(Prisma.sql`
            WITH candidates AS (
                SELECT item."id", item."entityType", item."entityId", item."createdAt"
                FROM "SpreadsheetSyncOutbox" AS item
                WHERE item."status" IN ('PENDING'::"SpreadsheetSyncStatus", 'FAILED'::"SpreadsheetSyncStatus")
                    AND item."nextAttemptAt" IS NOT NULL
                    AND item."nextAttemptAt" <= NOW()
                    AND NOT EXISTS (
                        SELECT 1
                        FROM "SpreadsheetSyncOutbox" AS processing
                        WHERE processing."entityType" = item."entityType"
                            AND processing."entityId" = item."entityId"
                            AND processing."status" = 'PROCESSING'::"SpreadsheetSyncStatus"
                    )
                    AND pg_try_advisory_xact_lock(
                        hashtextextended(item."entityType"::text || ':' || item."entityId", 0)
                    )
                ORDER BY item."createdAt", item."id"
                LIMIT ${batchSize}
            ),
            entities AS (
                SELECT DISTINCT "entityType", "entityId"
                FROM candidates
            )
            UPDATE "SpreadsheetSyncOutbox" AS item
            SET "status" = 'PROCESSING'::"SpreadsheetSyncStatus",
                "processedAt" = NOW()
            FROM entities
            WHERE item."entityType" = entities."entityType"
                AND item."entityId" = entities."entityId"
                AND item."status" IN ('PENDING'::"SpreadsheetSyncStatus", 'FAILED'::"SpreadsheetSyncStatus")
                AND item."nextAttemptAt" IS NOT NULL
                AND item."nextAttemptAt" <= NOW()
            RETURNING item."id", item."entityType", item."entityId", item."operation",
                item."payload", item."attempts", item."createdAt"
        `);
    });
}

function coalesceClaimedItems(items: OutboxItem[]) {
    return coalesceUpdates(
        items.map((item) => ({ ...item, payload: item.payload as Record<string, unknown> })),
    );
}

function transientFailure(error: unknown) {
    return isTransientSheetsFailure(error);
}

function retryDelay(attempt: number) {
    const exponentialDelay = Math.min(
        retryMaxMs,
        retryBaseMs * 2 ** Math.max(0, Math.min(attempt - 1, 16)),
    );
    const jitter = 0.75 + Math.random() * 0.5;
    return Math.round(exponentialDelay * jitter);
}

async function finishBatch(items: OutboxItem[]) {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    await prisma.spreadsheetSyncOutbox.updateMany({
        where: { id: { in: ids }, status: "PROCESSING" },
        data: {
            status: "COMPLETED",
            processedAt: new Date(),
            nextAttemptAt: null,
            lastError: null,
        },
    });
}

async function failBatch(items: OutboxItem[], error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown Sheets error";
    const latestAttempt = Math.max(...items.map((item) => item.attempts + 1));
    // Every failure is retried: errors Google calls permanent (a missing tab, unexpected headers)
    // are usually fixed in the spreadsheet, so those wait at least the longest retry interval.
    const delay = transientFailure(error)
        ? retryDelay(latestAttempt)
        : Math.max(retryMaxMs, retryDelay(latestAttempt));
    const nextAttemptAt = new Date(Date.now() + delay);
    await prisma.spreadsheetSyncOutbox.updateMany({
        where: { id: { in: items.map((item) => item.id) }, status: "PROCESSING" },
        data: {
            status: "FAILED",
            attempts: { increment: 1 },
            processedAt: new Date(),
            nextAttemptAt,
            lastError: message,
        },
    });
    lastWorkerError = message;
}

export async function processOutboxBatch() {
    if (!hasConfiguration()) return 0;
    const claimedItems = await claimBatch();
    if (claimedItems.length === 0) return 0;

    const coalescedItems = coalesceClaimedItems(claimedItems);
    try {
        await withSheetWriteLock(() => sendSheetBatch(coalescedItems));
        await finishBatch(claimedItems);
        lastWorkerError = null;
        return claimedItems.length;
    } catch (error) {
        // A tab may have been renamed or deleted meanwhile; look the tabs up again on the retry.
        preparedTabs.clear();
        tabAliases.clear();
        await failBatch(claimedItems, error);
        return 0;
    }
}

function buildDatabaseRows(
    users: Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        createdAt: Date;
        updatedAt: Date;
    }>,
    events: Event[],
    registrations: Array<Prisma.RegistrationGetPayload<{ include: typeof registrationSyncInclude }>>,
    participants: Participant[],
    proofs: Array<
        Pick<
            PaymentProof,
            | "id"
            | "registrationId"
            | "utr"
            | "paymentMethod"
            | "screenshotMimeType"
            | "status"
            | "reviewedById"
            | "reviewedAt"
            | "rejectionReason"
            | "submittedAt"
        >
    >,
) {
    const rows = new Map<SpreadsheetEntityType, Record<string, unknown>[]>();
    rows.set("USER", users.map((user) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    })));
    rows.set("EVENT", events.map((event) => ({
        eventId: event.id,
        name: event.name,
        slug: event.slug,
        description: event.description ?? "",
        feePaise: event.feePaise,
        feeMode: event.feeMode,
        minTeamSize: event.minTeamSize,
        maxTeamSize: event.maxTeamSize,
        isPublished: event.isPublished,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
    })));
    rows.set("REGISTRATION", registrations.map(registrationSheetRow));
    rows.set("PARTICIPANT", participants.map(participantRow));
    rows.set("PAYMENT_PROOF", proofs.map((proof) => ({
        proofId: proof.id,
        registrationId: proof.registrationId,
        utr: proof.utr,
        paymentMethod: proof.paymentMethod,
        screenshotMimeType: proof.screenshotMimeType,
        status: proof.status,
        reviewedById: proof.reviewedById ?? "",
        reviewedAt: proof.reviewedAt?.toISOString() ?? "",
        rejectionReason: proof.rejectionReason ?? "",
        submittedAt: proof.submittedAt.toISOString(),
        screenshotReference: `/admin/payment-proofs/${proof.id}/screenshot`,
    })));
    return rows;
}

export async function reconcileSpreadsheet(retryFailed = false) {
    if (!hasConfiguration()) {
        throw Object.assign(new Error("Google Sheets credentials are not configured"), {
            status: 503, expose: true, notConfigured: true,
        });
    }
    const [users, events, registrations, participants, proofs] = await Promise.all([
        prisma.user.findMany({
            where: { role: "USER" },
            select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
        }),
        prisma.event.findMany(),
        prisma.registration.findMany({ include: registrationSyncInclude }),
        prisma.participant.findMany(),
        prisma.paymentProof.findMany({
            select: {
                id: true,
                registrationId: true,
                utr: true,
                paymentMethod: true,
                screenshotMimeType: true,
                status: true,
                reviewedById: true,
                reviewedAt: true,
                rejectionReason: true,
                submittedAt: true,
            },
        }),
    ]);
    const expectedRows = buildDatabaseRows(users, events, registrations, participants, proofs);
    // One tab per event, even before its first registration.
    const eventTabs = [...new Set(events.map((event) => event.name))].map(eventTab);
    const allTabs: Array<SheetDefinition & { eventName?: string }> = [...definitions, ...eventTabs];
    const currentRanges = await withSheetWriteLock(async () => {
        await prepareWorksheets(allTabs);
        const ranges = await readRows(allTabs);
        return (await removeStrayRows(allTabs, ranges)) ? readRows(allTabs) : ranges;
    });
    const outboxRows: { entityType: SpreadsheetEntityType; entityId: string; payload: Prisma.InputJsonValue }[] = [];
    const queuedKeys = new Set<string>();
    let missing = 0;
    let stale = 0;
    let duplicateRows = 0;

    allTabs.forEach((definition, sheetIndex) => {
        const actualRows = currentRanges[sheetIndex]?.values ?? [];
        const idIndex = definition.headers.indexOf(definition.idColumn);
        const actualById = new Map<string, unknown[]>();
        const duplicates = new Set<string>();
        for (const actualRow of actualRows.slice(1)) {
            const id = String(actualRow[idIndex] ?? "");
            if (!id) continue;
            if (actualById.has(id)) duplicates.add(id);
            else actualById.set(id, actualRow);
        }
        duplicateRows += duplicates.size;

        const wantedRows = (expectedRows.get(definition.entityType) ?? []).filter(
            (payload) => definition.eventName === undefined || payload.event === definition.eventName,
        );
        const wantedIds = new Set<string>();
        // A registration missing from both the Registrations tab and its event tab is queued once.
        const queue = (id: string, payload: Record<string, unknown>) => {
            const key = `${definition.entityType}:${id}`;
            if (queuedKeys.has(key)) return;
            queuedKeys.add(key);
            outboxRows.push({
                entityType: definition.entityType,
                entityId: id,
                payload: payload as Prisma.InputJsonValue,
            });
        };
        for (const payload of wantedRows) {
            const id = String(payload[definition.idColumn] ?? "");
            wantedIds.add(id);
            if (duplicates.has(id)) continue;
            const existingRow = actualById.get(id);
            const wantedCells = toCells(definition, payload);
            if (!existingRow) {
                missing += 1;
                queue(id, payload);
            } else if (!rowsMatch(wantedCells, existingRow)) {
                stale += 1;
                queue(id, payload);
            }
        }
        for (const id of actualById.keys()) {
            if (!wantedIds.has(id)) stale += 1;
        }
    });

    const result = await prisma.$transaction(async (tx) => {
        if (retryFailed) {
            await tx.spreadsheetSyncOutbox.updateMany({
                where: { status: "FAILED" },
                data: { status: "PENDING", nextAttemptAt: new Date(), processedAt: null },
            });
        } else {
            // Failures from before every failure got a retry time would otherwise never run again.
            await tx.spreadsheetSyncOutbox.updateMany({
                where: { status: "FAILED", nextAttemptAt: null },
                data: { status: "PENDING", nextAttemptAt: new Date(), processedAt: null },
            });
        }
        const active = await tx.spreadsheetSyncOutbox.findMany({
            where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
            select: { entityType: true, entityId: true },
        });
        const activeKeys = new Set(active.map((item) => `${item.entityType}:${item.entityId}`));
        const newRows = outboxRows.filter(
            (item) => !activeKeys.has(`${item.entityType}:${item.entityId}`),
        );
        // Updates still waiting to be sent get the current state, so an old snapshot (e.g. one
        // queued before an event was renamed) is never written over newer data or into an old tab.
        let refreshed = 0;
        for (const item of outboxRows.filter((row) => activeKeys.has(`${row.entityType}:${row.entityId}`))) {
            const updated = await tx.spreadsheetSyncOutbox.updateMany({
                where: { entityType: item.entityType, entityId: item.entityId, status: { in: ["PENDING", "FAILED"] } },
                data: { payload: item.payload },
            });
            refreshed += updated.count;
        }
        const created = newRows.length
            ? await tx.spreadsheetSyncOutbox.createMany({
                  data: newRows.map((item) => ({ ...item, operation: "UPSERT" })),
              })
            : { count: 0 };
        return { queued: created.count, refreshed };
    });

    lastReconciliation = {
        at: new Date().toISOString(),
        queued: result.queued,
        refreshed: result.refreshed,
        missing,
        stale,
        duplicateRows,
    };
    return lastReconciliation;
}

// Reads every event's own tab from the spreadsheet, for the super admin overview. Returns, per event
// name, the tab title read and its rows (header row first); null rows mean the tab doesn't exist yet.
export async function readEventTabs(eventNames: string[]) {
    if (!hasConfiguration())
        throw Object.assign(new Error("Google Sheets isn't configured, so the overview can't be read from it"), {
            status: 503, expose: true, notConfigured: true,
        });
    const tabs = eventNames.map(eventTab);
    const sheetsApi = getSheetsClient();
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    const existing = new Set((meta.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? ""));
    const present = tabs.filter((tab) => existing.has(sheetTitle(tab)));
    const values = present.length ? await readRows(present) : [];
    const rowsByTitle = new Map(present.map((tab, i) => [tab.title, (values[i]?.values ?? []) as unknown[][]]));
    return tabs.map((tab) => ({
        eventName: tab.eventName,
        tab: sheetTitle(tab),
        rows: rowsByTitle.get(tab.title) ?? null,
    }));
}

export async function getSyncStatus() {
    const [counts, failureAggregate, lastFailure, lastSuccess] = await Promise.all([
        prisma.spreadsheetSyncOutbox.groupBy({
            by: ["status"],
            _count: { _all: true },
        }),
        prisma.spreadsheetSyncOutbox.aggregate({
            where: { status: "FAILED" },
            _sum: { attempts: true },
        }),
        prisma.spreadsheetSyncOutbox.findFirst({
            where: { status: "FAILED" },
            orderBy: { processedAt: "desc" },
            select: { lastError: true, processedAt: true },
        }),
        prisma.spreadsheetSyncOutbox.aggregate({
            where: { status: "COMPLETED" },
            _max: { processedAt: true },
            _count: { _all: true },
        }),
    ]);
    return {
        configured: hasConfiguration(),
        counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])),
        failedAttempts: failureAggregate._sum.attempts ?? 0,
        lastSuccessfulSyncAt: lastSuccess._max.processedAt,
        synchronizedRecords: lastSuccess._count._all,
        lastError: lastWorkerError ?? lastFailure?.lastError ?? null,
        lastFailureAt: lastFailure?.processedAt ?? null,
        reconciliation: lastReconciliation,
    };
}

export async function startOutboxWorker() {
    if (!hasConfiguration()) {
        console.warn("Google Sheets sync is disabled; outbox entries remain in PostgreSQL");
        return () => undefined;
    }

    let stopped = false;
    let initialized = false;
    let nextReconciliation = 0;
    let retryAttempt = 0;
    let retryAfter = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
        if (stopped) return;
        const delayUntilRetry = retryAfter - Date.now();
        if (delayUntilRetry > 0) {
            timer = setTimeout(run, Math.max(pollIntervalMs, delayUntilRetry));
            return;
        }
        try {
            if (!initialized) {
                await reconcileSpreadsheet();
                initialized = true;
                nextReconciliation = Date.now() + reconcileIntervalMs;
            } else if (Date.now() >= nextReconciliation) {
                await reconcileSpreadsheet();
                nextReconciliation = Date.now() + reconcileIntervalMs;
            }
            await processOutboxBatch();
            lastWorkerError = null;
            retryAttempt = 0;
            retryAfter = 0;
        } catch (error) {
            lastWorkerError = error instanceof Error ? error.message.slice(0, 1000) : "Sheets worker failed";
            console.error("Google Sheets worker error:", lastWorkerError);
            if (!transientFailure(error)) initialized = false;
            retryAttempt += 1;
            retryAfter = Date.now() + retryDelay(retryAttempt);
        }
        if (!stopped) timer = setTimeout(run, pollIntervalMs);
    };

    void run();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
