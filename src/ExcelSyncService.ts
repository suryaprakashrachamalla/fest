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
import { coalesceUpdates, isTransientSheetsFailure, planSheetRows } from "./lib/sheetsSyncLogic.ts";

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
        headers: [
            "registrationId",
            "userId",
            "eventId",
            "eventName",
            "teamName",
            "teamSize",
            "amountPaise",
            "verified",
            "verifiedAt",
            "verifiedById",
            "entryAllowed",
            "entryAuthorizedAt",
            "entryAuthorizedById",
            "entered",
            "enteredAt",
            "enteredById",
            "createdAt",
            "updatedAt",
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
            "college",
            "rollNumber",
            "createdAt",
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
            status: 503,
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

async function initializeWorksheets() {
    const sheetsApi = getSheetsClient();
    const spreadsheet = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
    });
    const existingTitles = new Set(
        (spreadsheet.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? ""),
    );
    const missingSheets = definitions.filter((definition) => !existingTitles.has(definition.title));

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

    const headerRanges = definitions.map(
        (definition) =>
            `${quoteSheet(definition.title)}!A1:${columnName(definition.headers.length)}1`,
    );
    const headerResult = await sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: headerRanges,
        valueRenderOption: "UNFORMATTED_VALUE",
    });
    const headerWrites: sheets_v4.Schema$ValueRange[] = [];

    definitions.forEach((definition, index) => {
        const values = headerResult.data.valueRanges?.[index]?.values?.[0] ?? [];
        if (values.length === 0 || values.every((value) => value === "")) {
            headerWrites.push({
                range: headerRanges[index],
                values: [definition.headers],
            });
            return;
        }
        if (!rowsMatch(definition.headers, values)) {
            throw new Error(
                `Worksheet ${definition.title} has unexpected headers. Expected: ${definition.headers.join(", ")}`,
            );
        }
    });

    if (headerWrites.length > 0) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: "RAW", data: headerWrites },
        });
    }
}

async function readRows(definitionsToRead: SheetDefinition[]) {
    const sheetsApi = getSheetsClient();
    const ranges = definitionsToRead.map(
        (definition) =>
            `${quoteSheet(definition.title)}!A1:${columnName(definition.headers.length)}`,
    );
    const response = await sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: "UNFORMATTED_VALUE",
    });
    return response.data.valueRanges ?? [];
}

async function sendSheetBatch(items: CoalescedItem[]) {
    const itemsForSheet = items.filter(
        (item) => !(item.entityType === "USER" && item.payload.role === "ADMIN"),
    );
    if (itemsForSheet.length === 0) return;

    const touchedDefinitions = definitions.filter((definition) =>
        itemsForSheet.some((item) => item.entityType === definition.entityType),
    );
    const currentRows = await readRows(touchedDefinitions);
    const updates: sheets_v4.Schema$ValueRange[] = [];
    const appendRows = new Map<string, { definition: SheetDefinition; rows: unknown[][] }>();

    touchedDefinitions.forEach((definition, definitionIndex) => {
        const rows = currentRows[definitionIndex]?.values ?? [];
        const sheetItems = itemsForSheet.filter((item) => item.entityType === definition.entityType);
        const plan = planSheetRows(
            definition.idColumn,
            definition.headers,
            sheetItems,
            rows,
        );
        const lastColumn = columnName(definition.headers.length);
        updates.push(
            ...plan.updates.map(({ rowNumber, values }) => ({
                range: `${quoteSheet(definition.title)}!A${rowNumber}:${lastColumn}${rowNumber}`,
                values: [values],
            })),
        );
        if (plan.appendRows.length > 0)
            appendRows.set(definition.title, { definition, rows: plan.appendRows });
    });

    const sheetsApi = getSheetsClient();
    if (updates.length > 0) {
        await sheetsApi.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: { valueInputOption: "RAW", data: updates },
        });
    }

    for (const { definition, rows } of appendRows.values()) {
        await sheetsApi.spreadsheets.values.append({
            spreadsheetId,
            range: `${quoteSheet(definition.title)}!A:${columnName(definition.headers.length)}`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: rows },
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
    const shouldRetry = transientFailure(error);
    const latestAttempt = Math.max(...items.map((item) => item.attempts + 1));
    const nextAttemptAt = shouldRetry
        ? new Date(Date.now() + retryDelay(latestAttempt))
        : null;
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
        await sendSheetBatch(coalescedItems);
        await finishBatch(claimedItems);
        lastWorkerError = null;
        return claimedItems.length;
    } catch (error) {
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
    registrations: Array<Registration & { event: Event }>,
    participants: Participant[],
    proofs: Array<
        Pick<
            PaymentProof,
            | "id"
            | "registrationId"
            | "utr"
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
        minTeamSize: event.minTeamSize,
        maxTeamSize: event.maxTeamSize,
        isPublished: event.isPublished,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
    })));
    rows.set("REGISTRATION", registrations.map((registration) => ({
        registrationId: registration.id,
        userId: registration.userId,
        eventId: registration.eventId,
        eventName: registration.event.name,
        teamName: registration.teamName,
        teamSize: registration.teamSize,
        amountPaise: registration.amountPaise,
        verified: registration.verified,
        verifiedAt: registration.verifiedAt?.toISOString() ?? "",
        verifiedById: registration.verifiedById ?? "",
        entryAllowed: registration.entryAllowed,
        entryAuthorizedAt: registration.entryAuthorizedAt?.toISOString() ?? "",
        entryAuthorizedById: registration.entryAuthorizedById ?? "",
        entered: registration.entered,
        enteredAt: registration.enteredAt?.toISOString() ?? "",
        enteredById: registration.enteredById ?? "",
        createdAt: registration.createdAt.toISOString(),
        updatedAt: registration.updatedAt.toISOString(),
    })));
    rows.set("PARTICIPANT", participants.map((participant) => ({
        participantId: participant.id,
        registrationId: participant.registrationId,
        participantName: participant.name,
        college: participant.college,
        rollNumber: participant.rollNumber ?? "",
        createdAt: participant.createdAt.toISOString(),
    })));
    rows.set("PAYMENT_PROOF", proofs.map((proof) => ({
        proofId: proof.id,
        registrationId: proof.registrationId,
        utr: proof.utr,
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
            status: 503,
        });
    }
    await initializeWorksheets();

    const [users, events, registrations, participants, proofs] = await Promise.all([
        prisma.user.findMany({
            where: { role: "USER" },
            select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
        }),
        prisma.event.findMany(),
        prisma.registration.findMany({ include: { event: true } }),
        prisma.participant.findMany(),
        prisma.paymentProof.findMany({
            select: {
                id: true,
                registrationId: true,
                utr: true,
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
    const currentRanges = await readRows(definitions);
    const outboxRows: { entityType: SpreadsheetEntityType; entityId: string; payload: Prisma.InputJsonValue }[] = [];
    let missing = 0;
    let stale = 0;
    let duplicateRows = 0;

    definitions.forEach((definition, sheetIndex) => {
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

        const wantedRows = expectedRows.get(definition.entityType) ?? [];
        const wantedIds = new Set<string>();
        for (const payload of wantedRows) {
            const id = String(payload[definition.idColumn] ?? "");
            wantedIds.add(id);
            if (duplicates.has(id)) continue;
            const existingRow = actualById.get(id);
            const wantedCells = toCells(definition, payload);
            if (!existingRow) {
                missing += 1;
                outboxRows.push({
                    entityType: definition.entityType,
                    entityId: id,
                    payload: payload as Prisma.InputJsonValue,
                });
            } else if (!rowsMatch(wantedCells, existingRow)) {
                stale += 1;
                outboxRows.push({
                    entityType: definition.entityType,
                    entityId: id,
                    payload: payload as Prisma.InputJsonValue,
                });
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
        }
        const active = await tx.spreadsheetSyncOutbox.findMany({
            where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
            select: { entityType: true, entityId: true },
        });
        const activeKeys = new Set(active.map((item) => `${item.entityType}:${item.entityId}`));
        const newRows = outboxRows.filter(
            (item) => !activeKeys.has(`${item.entityType}:${item.entityId}`),
        );
        const created = newRows.length
            ? await tx.spreadsheetSyncOutbox.createMany({
                  data: newRows.map((item) => ({ ...item, operation: "UPSERT" })),
              })
            : { count: 0 };
        return created.count;
    });

    lastReconciliation = {
        at: new Date().toISOString(),
        queued: result,
        missing,
        stale,
        duplicateRows,
    };
    return lastReconciliation;
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
