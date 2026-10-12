// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { sheets_v4 } from "googleapis";
import { prisma } from "./lib/prisma.ts";
import { queueRegistrationSync } from "./lib/registrationSync.ts";
import * as registrations from "./RegistrationsService.ts";

// Per-event worksheet tabs, synced into an in-memory spreadsheet (never Google's API).
const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
process.env.GOOGLE_SPREADSHEET_ID ??= "in-memory-test-sheet";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??= "sheets-test@example.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ??= "not-a-real-key";
const sync = await import("./ExcelSyncService.ts");

const runId = crypto.randomUUID().slice(0, 8);
const ids = { teamEvent: "", soloEvent: "", lateEvent: "", users: [] as string[] };
const names = { team: `Tab Team ${runId}`, solo: `Tab Solo ${runId}`, late: `Tab Late ${runId}` };

// Just enough of the Sheets API for the sync: tabs, header rows, ranged reads, row updates, appends.
const tabs = new Map<string, unknown[][]>();
function parseRange(range: string) {
    const match = range.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
    if (!match) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
    const title = match[1].replace(/''/g, "'");
    if (!tabs.has(title)) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
    return { grid: tabs.get(title)!, startRow: match[3] ? Number(match[3]) : 1, endRow: match[5] ? Number(match[5]) : undefined };
}
const fakeSheets = {
    spreadsheets: {
        get: async () => ({ data: { sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) } }),
        batchUpdate: async ({ requestBody }: { requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }) => {
            for (const request of requestBody.requests ?? []) {
                const title = request.addSheet?.properties?.title;
                if (!title || tabs.has(title)) throw Object.assign(new Error("bad addSheet"), { code: 400 });
                tabs.set(title, []);
            }
            return { data: {} };
        },
        values: {
            batchGet: async ({ ranges }: { ranges: string[] }) => ({
                data: {
                    valueRanges: ranges.map((range) => {
                        const { grid, startRow, endRow } = parseRange(range);
                        return { values: grid.slice(startRow - 1, endRow ?? grid.length).map((row) => [...row]) };
                    }),
                },
            }),
            batchUpdate: async ({ requestBody }: { requestBody: sheets_v4.Schema$BatchUpdateValuesRequest }) => {
                for (const write of requestBody.data ?? []) {
                    const { grid, startRow } = parseRange(write.range!);
                    (write.values ?? []).forEach((row, index) => (grid[startRow - 1 + index] = [...row]));
                }
                return { data: {} };
            },
            append: async ({ range, requestBody }: { range: string; requestBody: sheets_v4.Schema$ValueRange }) => {
                parseRange(range).grid.push(...(requestBody.values ?? []).map((row) => [...row]));
                return { data: {} };
            },
        },
    },
} as unknown as sheets_v4.Sheets;

const rowsOf = (title: string) => tabs.get(title) ?? [];
const codesIn = (title: string) => rowsOf(title).slice(1).map((row) => row[0]);

async function drainOutbox() {
    for (let i = 0; i < 100; i++) if ((await sync.processOutboxBatch()) === 0) break;
    const status = await sync.getSyncStatus();
    expect(status.counts.FAILED ?? 0).toBe(0);
    expect(status.counts.PENDING ?? 0).toBe(0);
}
async function register(eventId: string, label: string, size: number, teamName?: string) {
    const user = await prisma.user.create({ data: { name: label, email: `${label}-${runId}@example.com`, passwordHash: "x" } });
    ids.users.push(user.id);
    return registrations.createRegistration(user.id, eventId, {
        teamName,
        college: "Test College",
        phone: "9876543210",
        participants: Array.from({ length: size }, (_, i) => ({ name: `${label} member ${i + 1}`, email: `${label}-m${i + 1}-${runId}@example.com` })),
    });
}

beforeAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    sync.setSheetsClientForTests(fakeSheets);
    // The test database's leftover queue would otherwise be replayed into the fake sheet.
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { status: { not: "COMPLETED" } } });
    const base = { isPublished: true, description: null, feePaise: 10_000 };
    ids.teamEvent = (await prisma.event.create({ data: { ...base, name: names.team, slug: `tab-team-${runId}`, feeMode: "PER_HEAD", minTeamSize: 1, maxTeamSize: 2 } })).id;
    ids.soloEvent = (await prisma.event.create({ data: { ...base, name: names.solo, slug: `tab-solo-${runId}`, minTeamSize: 1, maxTeamSize: 1 } })).id;
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    sync.setSheetsClientForTests(null);
    const eventIds = [ids.teamEvent, ids.soloEvent, ids.lateEvent].filter(Boolean);
    const regs = await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true, code: true } });
    const regIds = regs.map((r) => r.id);
    const memberIds = (await prisma.participant.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } })).map((p) => p.id);
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { entityId: { in: [...regIds, ...regs.map((r) => r.code), ...memberIds, ...eventIds, ...ids.users] } } });
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
});

integrationTest("each event gets its own tab holding only that event's registrations", async () => {
    const pair = await register(ids.teamEvent, "pair", 2, "Tab Pair");
    const solo = await register(ids.soloEvent, "solo", 1);

    await sync.reconcileSpreadsheet();
    await drainOutbox();

    // Shared tabs are still there, alongside one tab per event (created even before registrations).
    for (const title of ["Events", "Registrations", "Participants", "PaymentProofs", "Users", names.team, names.solo])
        expect(tabs.has(title)).toBe(true);
    expect(rowsOf(names.team)[0]).toEqual([
        "registrationId", "teamName", "teamSize", "participantNames", "emails", "rollNumbers", "phone", "college",
        "registrationFee", "utr", "paymentStatus", "approvalStatus", "ticketStatus", "emailStatus", "checkedIn",
        "checkedInAt", "registeredAt", "updatedAt",
    ]);
    expect(codesIn(names.team)).toEqual([pair.code]);
    expect(codesIn(names.solo)).toEqual([solo.code]);
    // Everything still lands in the combined Registrations tab too.
    expect(codesIn("Registrations")).toEqual(expect.arrayContaining([pair.code, solo.code]));

    const pairRow = rowsOf(names.team)[1];
    expect(pairRow[1]).toBe("Tab Pair");
    expect(pairRow[3]).toBe("pair member 1, pair member 2");
    expect(pairRow[8]).toBe("200.00");
    expect(pairRow[11]).toBe("PENDING");
    // A solo registration has no team name.
    expect(rowsOf(names.solo)[1][1]).toBe("");
});

integrationTest("a change to a registration updates its row in place in the event tab", async () => {
    const reg = await prisma.registration.findFirstOrThrow({ where: { eventId: ids.teamEvent } });
    const before = rowsOf(names.team).length;
    await prisma.$transaction(async (tx) => {
        await tx.registration.update({ where: { id: reg.id }, data: { status: "APPROVED", approvedAt: new Date() } });
        await queueRegistrationSync(tx, reg.id);
    });
    await drainOutbox();

    expect(rowsOf(names.team).length).toBe(before);
    expect(rowsOf(names.team)[1][11]).toBe("APPROVED");
    expect(rowsOf(names.solo)[1][11]).toBe("PENDING");
});

integrationTest("an event added later gets its tab on its first registration, without waiting for a full check", async () => {
    ids.lateEvent = (await prisma.event.create({
        data: { isPublished: true, description: null, feePaise: 10_000, name: names.late, slug: `tab-late-${runId}`, minTeamSize: 1, maxTeamSize: 1 },
    })).id;
    expect(tabs.has(names.late)).toBe(false);

    const late = await register(ids.lateEvent, "late", 1);
    await drainOutbox();

    expect(rowsOf(names.late)[0][0]).toBe("registrationId");
    expect(codesIn(names.late)).toEqual([late.code]);
});

integrationTest("a full check after the event tabs exist finds nothing to fix", async () => {
    // The late event and its user were created straight in the database, so the first check adds them.
    await sync.reconcileSpreadsheet();
    await drainOutbox();
    const result = await sync.reconcileSpreadsheet();
    expect(result.queued).toBe(0);
});
