// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createFakeSheets } from "./testing/fakeSheets.ts";
import { prisma } from "./lib/prisma.ts";
import { queueRegistrationSync } from "./lib/registrationSync.ts";
import * as registrations from "./RegistrationsService.ts";

// Per-event worksheet tabs, synced into an in-memory spreadsheet (never Google's API).
const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
process.env.GOOGLE_SPREADSHEET_ID ??= "in-memory-test-sheet";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??= "sheets-test@example.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ??= "not-a-real-key";
// Short retry waits so a failed batch can be retried within the test.
process.env.SHEETS_RETRY_BASE_MS = "500";
process.env.SHEETS_RETRY_MAX_MS = "600";
const sync = await import("./ExcelSyncService.ts");

const runId = crypto.randomUUID().slice(0, 8);
const ids = { teamEvent: "", soloEvent: "", lateEvent: "", users: [] as string[] };
const names = { team: `Tab Team ${runId}`, solo: `Tab Solo ${runId}`, late: `Tab Late ${runId}` };

const { client: fakeSheets, tabs, grids, gridOf } = createFakeSheets();

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
        "checkedInAt", "registeredAt", "updatedAt", "teamCode", "discount",
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

integrationTest("a shared tab deleted from the spreadsheet is recreated and the failed update still arrives", async () => {
    const reg = await prisma.registration.findFirstOrThrow({ where: { eventId: ids.soloEvent } });
    tabs.delete("Registrations");
    grids.delete("Registrations");
    await prisma.$transaction(async (tx) => {
        await tx.registration.update({ where: { id: reg.id }, data: { status: "APPROVED", approvedAt: new Date() } });
        await queueRegistrationSync(tx, reg.id);
    });

    // The first attempt fails on the missing tab ("Unable to parse range") but is kept for a retry.
    expect(await sync.processOutboxBatch()).toBe(0);
    const failed = await prisma.spreadsheetSyncOutbox.findFirstOrThrow({ where: { entityId: reg.code, status: "FAILED" } });
    expect(failed.lastError).toMatch(/Unable to parse range/);
    expect(failed.nextAttemptAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 900));
    await drainOutbox();
    expect(rowsOf("Registrations")[0][0]).toBe("registrationId");
    const row = rowsOf("Registrations").find((r) => r[0] === reg.code);
    expect(row?.[13]).toBe("APPROVED");
    expect(rowsOf(names.solo)[1][11]).toBe("APPROVED");
});

integrationTest("an update stuck without a retry time (from older versions) is picked up by the next full check", async () => {
    const reg = await prisma.registration.findFirstOrThrow({ where: { eventId: ids.lateEvent } });
    await prisma.$transaction(async (tx) => {
        await tx.registration.update({ where: { id: reg.id }, data: { status: "REJECTED" } });
        await queueRegistrationSync(tx, reg.id);
    });
    await prisma.spreadsheetSyncOutbox.updateMany({
        where: { entityId: reg.code, status: "PENDING" },
        data: { status: "FAILED", nextAttemptAt: null, attempts: 1, lastError: "Unable to parse range: 'Registrations'!A1:AC" },
    });

    await sync.reconcileSpreadsheet();
    await drainOutbox();
    expect(rowsOf(names.late)[1][11]).toBe("REJECTED");
});

integrationTest("duplicate and shifted rows the sync wrote are removed; other rows are left alone", async () => {
    const registrationsBefore = rowsOf("Registrations").length;
    const participantsBefore = rowsOf("Participants").length;
    const [, firstReg] = rowsOf("Registrations");
    const [, firstMember] = rowsOf("Participants");
    // What was found in the real sheet: an exact copy of a row, and a copy written 8 columns to the right.
    rowsOf("Registrations").push([...firstReg]);
    rowsOf("Participants").push([...Array(8).fill(""), ...firstMember]);
    // An organizer's own note below the data (no ID) must stay.
    rowsOf("Participants").push(["", "Note: call the team lead before Day 1"]);
    gridOf("Registrations").rowCount = rowsOf("Registrations").length;
    gridOf("Participants").rowCount = rowsOf("Participants").length;

    await sync.reconcileSpreadsheet();
    await drainOutbox();

    expect(rowsOf("Registrations").length).toBe(registrationsBefore);
    expect(codesIn("Registrations").filter((code) => code === firstReg[0]).length).toBe(1);
    expect(rowsOf("Participants").length).toBe(participantsBefore + 1);
    expect(rowsOf("Participants").at(-1)).toEqual(["", "Note: call the team lead before Day 1"]);
    expect(rowsOf("Participants").some((row) => row[0] === "" && row[8] === firstMember[0])).toBe(false);
});

integrationTest("new rows are written at column A right below the last row, growing the grid when needed", async () => {
    const before = rowsOf(names.solo).length;
    const extra = await register(ids.soloEvent, "grow", 1);
    gridOf(names.solo).rowCount = before; // full grid: the next row must be added first
    await drainOutbox();

    expect(rowsOf(names.solo).length).toBe(before + 1);
    expect(rowsOf(names.solo).at(-1)?.[0]).toBe(extra.code);
});

integrationTest("an update queued before an event was renamed goes to the event's current tab", async () => {
    const reg = await register(ids.teamEvent, "renamed", 1, "Renamed Pair");
    // The queued snapshot still carries the event's old name (it was queued before a rename).
    const queued = await prisma.spreadsheetSyncOutbox.findFirstOrThrow({ where: { entityId: reg.code, status: "PENDING" } });
    await prisma.spreadsheetSyncOutbox.update({
        where: { id: queued.id },
        data: { payload: { ...(queued.payload as Record<string, unknown>), event: `Old name ${runId}` } },
    });

    const result = await sync.reconcileSpreadsheet();
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    await drainOutbox();
    expect(codesIn(names.team)).toContain(reg.code);
    expect(tabs.has(`Old name ${runId}`)).toBe(false);
});
