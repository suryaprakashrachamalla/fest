// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "./lib/prisma.ts";
import { queueRegistrationSync } from "./lib/registrationSync.ts";
import { createFakeSheets } from "./testing/fakeSheets.ts";
import * as registrations from "./RegistrationsService.ts";

// The organizer API over HTTP: registration lookup, single and bulk entry authorization, and the
// super-admin analytics with test-data exclusion. Real app and test database; the Google Sheet is
// the in-memory fake, and mail is never sent (the sender is injected).
const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "true";
process.env.GOOGLE_SPREADSHEET_ID ??= "in-memory-test-sheet";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ??= "sheets-test@example.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ??= "not-a-real-key";
const runId = crypto.randomUUID().slice(0, 8);
// A super admin of this test only (another ADMIN_SUPER*_EMAIL slot, so real settings are untouched).
const SUPER_ENV = "ADMIN_SUPER97_EMAIL";
const superEmail = `super-${runId}@example.com`;
process.env[SUPER_ENV] = superEmail;

const sync = await import("./ExcelSyncService.ts");
const analytics = await import("./OverviewService.ts");
const tickets = await import("./TicketService.ts");
const { default: app } = await import("./app.ts");
const sheet = createFakeSheets();

let server: Server;
let base = "";
const ids = {
    teamEvent: "",
    soloEvent: "",
    emptyEvent: "",
    users: {} as Record<string, string>,
    regs: {} as Record<string, { id: string; code: string }>,
};
const names = { team: `Api Team ${runId}`, solo: `Api Solo ${runId}`, empty: `Api Empty ${runId}` };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function tokenFor(label: string, expiresIn: number | string = "1h") {
    return jwt.sign({ sub: ids.users[label] }, process.env.JWT_SECRET!, {
        issuer: "fest-registration",
        algorithm: "HS256",
        expiresIn: expiresIn as never,
    });
}
async function call(method: string, path: string, who?: string | null, body?: unknown, rawToken?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = rawToken ?? (who ? tokenFor(who) : undefined);
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = response.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await response.json() : await response.text();
    return { status: response.status, body: data as any, type };
}
async function user(label: string, role: "USER" | "ADMIN" = "USER", email = `${label}-${runId}@mvsr.test`) {
    const created = await prisma.user.create({ data: { name: `${label} person`, email, passwordHash: "x", role } });
    ids.users[label] = created.id;
    return created;
}
// Each registration is made by its own account unless an owner is named (one per event per account).
async function register(label: string, owner: string, eventId: string, size: number, approved: boolean) {
    if (!ids.users[owner]) await user(owner);
    const reg = await registrations.createRegistration(ids.users[owner], eventId, {
        teamName: size > 1 || eventId === ids.teamEvent ? `Team ${label}` : undefined,
        college: "Test College",
        phone: "9876543210",
        participants: Array.from({ length: size }, (_, i) => ({ name: `${label} member ${i + 1}`, email: `${label}-m${i + 1}-${runId}@mvsr.test` })),
    });
    await prisma.paymentProof.create({
        data: {
            registrationId: reg.id,
            utr: `UTR${label}${runId}`.toUpperCase().slice(0, 32),
            screenshotBytes: new Uint8Array(PNG),
            screenshotMimeType: "image/png",
            status: approved ? "VERIFIED" : "PENDING",
        },
    });
    await prisma.$transaction(async (tx) => {
        await tx.registration.update({
            where: { id: reg.id },
            data: approved
                ? { status: "APPROVED", verified: true, verifiedAt: new Date(), approvedAt: new Date() }
                : { status: "PAYMENT_REVIEW" },
        });
        await queueRegistrationSync(tx, reg.id);
    });
    ids.regs[label] = { id: reg.id, code: reg.code };
    return ids.regs[label];
}
async function drainOutbox() {
    for (let i = 0; i < 100; i++) if ((await sync.processOutboxBatch()) === 0) break;
}
async function refreshSheet() {
    await sync.reconcileSpreadsheet();
    await drainOutbox();
    analytics.clearAnalyticsCache();
}
const eventRow = (overview: any, eventId: string) => overview.events.find((row: any) => row.eventId === eventId);

beforeAll(async () => {
    if (!enabled) return;
    sync.setSheetsClientForTests(sheet.client);
    process.env.ANALYTICS_CACHE_MS = "0";
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { status: { not: "COMPLETED" } } });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const event = { isPublished: true, description: null, feePaise: 10_000, feeMode: "PER_HEAD" as const };
    ids.teamEvent = (await prisma.event.create({ data: { ...event, name: names.team, slug: `api-team-${runId}`, minTeamSize: 1, maxTeamSize: 3 } })).id;
    ids.soloEvent = (await prisma.event.create({ data: { ...event, name: names.solo, slug: `api-solo-${runId}`, minTeamSize: 1, maxTeamSize: 1 } })).id;
    ids.emptyEvent = (await prisma.event.create({ data: { ...event, name: names.empty, slug: `api-empty-${runId}`, minTeamSize: 1, maxTeamSize: 1 } })).id;
    await user("super", "ADMIN", superEmail);
    await user("volunteer", "ADMIN");
    await user("alice");
    await user("bob");
    await user("qa", "USER", `qa-${runId}@example.com`);
    await register("trio", "alice", ids.teamEvent, 3, true);
    await register("solo", "bob", ids.soloEvent, 1, true);
    await register("review", "bob", ids.teamEvent, 2, false);
    await register("qatest", "qa", ids.teamEvent, 1, true);
    await register("organizer", "volunteer", ids.soloEvent, 1, true);
    await refreshSheet();
});

afterAll(async () => {
    if (!enabled) return;
    server?.close();
    sync.setSheetsClientForTests(null);
    delete process.env[SUPER_ENV];
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_checkin_${runId} ON "Participant"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_checkin_${runId}()`);
    const eventIds = [ids.teamEvent, ids.soloEvent, ids.emptyEvent].filter(Boolean);
    const regs = await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true, code: true } });
    const regIds = regs.map((r) => r.id);
    const members = await prisma.participant.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } });
    const proofs = await prisma.paymentProof.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } });
    const userIds = Object.values(ids.users);
    await prisma.analyticsExclusion.deleteMany({ where: { OR: [{ createdById: { in: userIds } }, { value: { in: regs.map((r) => r.code) } }] } });
    await prisma.spreadsheetSyncOutbox.deleteMany({
        where: { entityId: { in: [...regIds, ...regs.map((r) => r.code), ...members.map((m) => m.id), ...proofs.map((p) => p.id), ...eventIds, ...userIds] } },
    });
    await prisma.paymentProof.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("who may use the organizer API", () => {
    integrationTest("no token, a bad or expired token, and non-organizers are refused", async () => {
        const lookup = { code: ids.regs.trio.code };
        expect((await call("POST", "/admin/tickets/team", null, lookup)).status).toBe(401);
        expect((await call("POST", "/admin/tickets/team", null, lookup, "not-a-jwt")).status).toBe(401);
        expect((await call("POST", "/admin/tickets/team", null, lookup, tokenFor("volunteer", -10))).status).toBe(401);
        const forged = jwt.sign({ sub: ids.users.super }, "a-different-secret-that-is-long-enough!!", { issuer: "fest-registration" });
        expect((await call("POST", "/admin/tickets/team", null, lookup, forged)).status).toBe(401);
        expect((await call("POST", "/admin/tickets/team", "alice", lookup)).status).toBe(403);
        expect((await call("POST", `/admin/registrations/${ids.regs.trio.id}/check-in-members`, "alice", { participantIds: ["x"] })).status).toBe(403);
    });

    integrationTest("analytics and exclusion rules are for super admins only", async () => {
        for (const [method, path, body] of [
            ["GET", "/admin/overview"],
            ["GET", "/admin/analytics/records"],
            ["GET", "/admin/analytics/records.csv"],
            ["GET", "/admin/analytics/exclusions"],
            ["GET", "/admin/analytics/suggestions"],
            ["POST", "/admin/analytics/exclusions", { kind: "REGISTRATION", value: ids.regs.trio.code, reason: "nope" }],
            ["DELETE", "/admin/analytics/exclusions/00000000-0000-0000-0000-000000000000"],
        ] as [string, string, unknown?][]) {
            expect((await call(method, path, null, body)).status).toBe(401);
            expect((await call(method, path, "alice", body)).status).toBe(403);
            expect((await call(method, path, "volunteer", body)).status).toBe(403);
        }
        expect((await call("GET", "/admin/overview", "super")).status).toBe(200);
    });
});

describe("registration lookup", () => {
    integrationTest("invalid and unknown registration IDs are told apart", async () => {
        expect((await call("POST", "/admin/tickets/team", "volunteer", { code: "hello" })).status).toBe(400);
        expect((await call("POST", "/admin/tickets/team", "volunteer", { code: { $ne: null } })).status).toBe(400);
        expect((await call("POST", "/admin/tickets/team", "volunteer", {})).status).toBe(400);
        const unknown = await call("POST", "/admin/tickets/team", "volunteer", { code: "SG26-ZZZZZZZZ" });
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.message).toBe("No registration has this ID");
    });

    integrationTest("a group registration returns every member with payment, email and entry status", async () => {
        const found = await call("POST", "/admin/tickets/team", "volunteer", { code: `  ${ids.regs.trio.code.toLowerCase()} ` });
        expect(found.status).toBe(200);
        const team = found.body.data;
        expect(team.registration.code).toBe(ids.regs.trio.code);
        expect(team.registration.paymentStatus).toBe("VERIFIED");
        expect(team.eligibility).toEqual({ allowed: true, reason: "Approved and paid" });
        expect(team.members.map((m: any) => m.name)).toEqual(["trio member 1", "trio member 2", "trio member 3"]);
        for (const member of team.members) {
            expect(member).toMatchObject({ ticketEmail: "NOT_SENT", checkedInAt: null });
            expect(member.id).toBeString();
            expect(member).not.toHaveProperty("ticketCode");
        }
        const solo = (await call("POST", "/admin/tickets/team", "volunteer", { code: ids.regs.solo.code })).body.data;
        expect(solo.members).toHaveLength(1);
        expect(solo.registration.teamName).toBeNull();
    });

    integrationTest("a registration that isn't approved can't be authorized, and says why", async () => {
        const team = (await call("POST", "/admin/tickets/team", "volunteer", { code: ids.regs.review.code })).body.data;
        expect(team.admission).toBe("NOT_APPROVED");
        expect(team.eligibility.reason).toBe("Payment is still being verified");
        expect(team.registration.paymentStatus).toBe("PENDING");
        const attempt = await call("POST", `/admin/registrations/${ids.regs.review.id}/check-in-members`, "volunteer", {
            participantIds: [team.members[0].id],
        });
        expect(attempt.status).toBe(409);
        expect(attempt.body.error.message).toMatch(/still being verified/);
        expect(await prisma.participant.count({ where: { registrationId: ids.regs.review.id, checkedInAt: { not: null } } })).toBe(0);
    });
});

describe("entry authorization", () => {
    const authorize = (who: string, participantIds: unknown, requestId?: string) =>
        call("POST", `/admin/registrations/${ids.regs.trio.id}/check-in-members`, who, { participantIds, requestId });
    let members: { id: string; name: string }[] = [];

    integrationTest("malformed requests are refused without admitting anyone", async () => {
        members = (await call("POST", "/admin/tickets/team", "volunteer", { code: ids.regs.trio.code })).body.data.members;
        const solo = (await call("POST", "/admin/tickets/team", "volunteer", { code: ids.regs.solo.code })).body.data.members[0];
        for (const bad of [undefined, "abc", [], [1, 2], Array(11).fill(members[0].id), [solo.id]])
            expect((await authorize("volunteer", bad)).status).toBe(400);
        expect(await prisma.participant.count({ where: { registrationId: ids.regs.trio.id, checkedInAt: { not: null } } })).toBe(0);
    });

    integrationTest("one member, then everyone: each is admitted once and the rest are reported as already entered", async () => {
        const first = await authorize("volunteer", [members[0].id]);
        expect(first.status).toBe(200);
        expect(first.body.data.results).toEqual([{ participantId: members[0].id, name: "trio member 1", outcome: "ADMITTED" }]);

        const all = await authorize("volunteer", members.map((m) => m.id));
        expect(all.body.data.summary).toEqual({ admitted: 2, alreadyEntered: 1, failed: 0 });
        expect(all.body.data.results.find((r: any) => r.participantId === members[0].id).outcome).toBe("ALREADY_ENTERED");
        expect(all.body.data.team.members.every((m: any) => m.checkedInAt)).toBe(true);
        expect(await prisma.auditLog.count({ where: { registrationId: ids.regs.trio.id, action: "MEMBER_CHECKED_IN" } })).toBe(3);
    });

    integrationTest("retrying a request whose answer was lost reports the same admissions and admits nobody twice", async () => {
        const reg = await register("retry", "owner-retry", ids.teamEvent, 2, true);
        const people = (await call("POST", "/admin/tickets/team", "volunteer", { code: reg.code })).body.data.members;
        const requestId = crypto.randomUUID();
        const send = () =>
            call("POST", `/admin/registrations/${reg.id}/check-in-members`, "volunteer", { participantIds: people.map((p: any) => p.id), requestId });
        const first = await send();
        const retry = await send();
        expect(first.body.data.summary).toEqual({ admitted: 2, alreadyEntered: 0, failed: 0 });
        expect(retry.body.data.summary).toEqual({ admitted: 2, alreadyEntered: 0, failed: 0 });
        const audit = await prisma.auditLog.count({ where: { registrationId: reg.id, action: "MEMBER_CHECKED_IN" } });
        expect(audit).toBe(2);
        // A different request (another press of Authorize) sees them as already entered.
        const later = await call("POST", `/admin/registrations/${reg.id}/check-in-members`, "volunteer", {
            participantIds: [people[0].id],
            requestId: crypto.randomUUID(),
        });
        expect(later.body.data.results[0].outcome).toBe("ALREADY_ENTERED");
    });

    integrationTest("two organizers authorizing the same people at the same moment admit each person once", async () => {
        const reg = await register("race", "owner-race", ids.teamEvent, 3, true);
        const people = (await call("POST", "/admin/tickets/team", "volunteer", { code: reg.code })).body.data.members;
        const body = { participantIds: people.map((p: any) => p.id) };
        const [a, b] = await Promise.all([
            call("POST", `/admin/registrations/${reg.id}/check-in-members`, "volunteer", body),
            call("POST", `/admin/registrations/${reg.id}/check-in-members`, "super", body),
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(a.body.data.summary.admitted + b.body.data.summary.admitted).toBe(3);
        expect(a.body.data.summary.alreadyEntered + b.body.data.summary.alreadyEntered).toBe(3);
        expect(await prisma.auditLog.count({ where: { registrationId: reg.id, action: "MEMBER_CHECKED_IN" } })).toBe(3);
    });

    integrationTest("one member failing doesn't stop the others, and retrying admits only that member", async () => {
        const reg = await register("partial", "owner-partial", ids.teamEvent, 3, true);
        const people = (await call("POST", "/admin/tickets/team", "volunteer", { code: reg.code })).body.data.members;
        // A database error for one member only (a trigger in the test database).
        await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_checkin_${runId}() RETURNS trigger AS $$
            BEGIN
                IF NEW.id = '${people[1].id}' AND NEW."checkedInAt" IS NOT NULL THEN RAISE EXCEPTION 'simulated database failure'; END IF;
                RETURN NEW;
            END $$ LANGUAGE plpgsql`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_checkin_${runId} BEFORE UPDATE ON "Participant" FOR EACH ROW EXECUTE FUNCTION fail_checkin_${runId}()`);
        const mixed = await call("POST", `/admin/registrations/${reg.id}/check-in-members`, "volunteer", { participantIds: people.map((p: any) => p.id) });
        expect(mixed.status).toBe(200);
        expect(mixed.body.data.summary).toEqual({ admitted: 2, alreadyEntered: 0, failed: 1 });
        const failed = mixed.body.data.results.find((r: any) => r.outcome === "FAILED");
        expect(failed.participantId).toBe(people[1].id);
        expect(failed.message).toMatch(/Nothing was saved/);
        expect(mixed.body.data.team.members[1].checkedInAt).toBeNull();

        await prisma.$executeRawUnsafe(`DROP TRIGGER fail_checkin_${runId} ON "Participant"`);
        const retry = await call("POST", `/admin/registrations/${reg.id}/check-in-members`, "volunteer", { participantIds: [people[1].id] });
        expect(retry.body.data.summary).toEqual({ admitted: 1, alreadyEntered: 0, failed: 0 });
        expect(await prisma.auditLog.count({ where: { registrationId: reg.id, action: "MEMBER_CHECKED_IN" } })).toBe(3);
    });
});

describe("entry QR emails", () => {
    integrationTest("a failed email shows per member; a resend sends each member exactly one email", async () => {
        const previous = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
        Object.assign(process.env, { SMTP_HOST: "smtp.invalid", SMTP_USER: "fest@example.com", SMTP_PASS: "unused" });
        try {
            const reg = await register("mail", "owner-mail", ids.teamEvent, 2, true);
            const ours = (to: string) => to.startsWith(`mail-m`) && to.endsWith(`${runId}@mvsr.test`);
            await tickets.sendPendingTicketEmails({
                send: async (message) => {
                    if (ours(message.to)) throw new Error("mail server unavailable");
                },
            });
            const failed = (await call("POST", "/admin/tickets/team", "volunteer", { code: reg.code })).body.data;
            expect(failed.members.map((m: any) => m.ticketEmail)).toEqual(["FAILED", "FAILED"]);

            expect((await call("POST", `/admin/registrations/${reg.id}/resend-tickets`, "volunteer", {})).status).toBe(200);
            const sent: string[] = [];
            const record = async (message: { to: string }) => {
                if (ours(message.to)) sent.push(message.to);
            };
            await tickets.sendPendingTicketEmails({ send: record });
            await tickets.sendPendingTicketEmails({ send: record });
            expect(sent.sort()).toEqual([`mail-m1-${runId}@mvsr.test`, `mail-m2-${runId}@mvsr.test`]);
            const after = (await call("POST", "/admin/tickets/team", "volunteer", { code: reg.code })).body.data;
            expect(after.members.map((m: any) => m.ticketEmail)).toEqual(["SENT", "SENT"]);
        } finally {
            Object.assign(process.env, { SMTP_HOST: previous.host ?? "", SMTP_USER: previous.user ?? "", SMTP_PASS: previous.pass ?? "" });
        }
    });
});

describe("super-admin analytics", () => {
    const overview = async () => (await call("GET", "/admin/overview", "super")).body.data;

    integrationTest("counts come from the event tabs and match the database", async () => {
        await refreshSheet();
        const data = await overview();
        const team = eventRow(data, ids.teamEvent);
        // Approved in the team event: trio, qatest, retry, race, partial, mail. "review" is pending.
        expect(team.production).toMatchObject({ registrations: 7, approvedTeams: 6, paymentsUnderReview: 1 });
        expect(team.matchesDatabase).toBe(true);
        expect(team.approvedTeams).toBe(team.production.approvedTeams); // older field names still filled
        const empty = eventRow(data, ids.emptyEvent);
        expect(empty).toMatchObject({ tabFound: true, approvedTeams: 0, matchesDatabase: true });
        expect(empty.production.registrations).toBe(0);
    });

    integrationTest("excluding a test registration moves it out of the production numbers, without deleting it", async () => {
        const before = eventRow(await overview(), ids.teamEvent);
        const added = await call("POST", "/admin/analytics/exclusions", "super", {
            kind: "REGISTRATION",
            value: ids.regs.qatest.code.toLowerCase(),
            reason: "QA dry run",
        });
        expect(added.status).toBe(201);
        const after = eventRow(await overview(), ids.teamEvent);
        expect(after.production.approvedTeams).toBe(before.production.approvedTeams - 1);
        expect(after.production.approvedAmountPaise).toBe(before.production.approvedAmountPaise - 10_000);
        expect(after.excluded).toMatchObject({ registrations: 1, approvedTeams: 1, approvedAmountPaise: 10_000 });
        expect(after.matchesDatabase).toBe(true);
        // Still in the sheet and the database.
        expect(sheet.tabs.get(names.team)!.some((row) => row[0] === ids.regs.qatest.code)).toBe(true);
        expect(await prisma.registration.count({ where: { id: ids.regs.qatest.id } })).toBe(1);

        const excludedRecords = (await call("GET", "/admin/analytics/records?scope=excluded", "super")).body.data;
        expect(excludedRecords.records.map((r: any) => r.registrationId)).toEqual([ids.regs.qatest.code]);
        expect(excludedRecords.records[0].exclusionReason).toBe("Test registration: QA dry run");

        await call("DELETE", `/admin/analytics/exclusions/${added.body.data.id}`, "super");
        expect(eventRow(await overview(), ids.teamEvent).production.approvedTeams).toBe(before.production.approvedTeams);
    });

    integrationTest("excluding an account leaves out every registration it made", async () => {
        const added = await call("POST", "/admin/analytics/exclusions", "super", { kind: "ACCOUNT", value: ` BOB-${runId}@MVSR.TEST `, reason: "Tester" });
        expect(added.status).toBe(201);
        const data = await overview();
        // bob made "solo" (solo event) and "review" (team event).
        expect(eventRow(data, ids.soloEvent).excluded.registrations).toBe(1);
        expect(eventRow(data, ids.teamEvent).excluded.registrations).toBe(1);
        expect(data.totals.excluded.registrations).toBeGreaterThanOrEqual(2);
        const rules = (await call("GET", "/admin/analytics/exclusions", "super")).body.data;
        expect(rules.find((r: any) => r.id === added.body.data.id)).toMatchObject({ kind: "ACCOUNT", registrations: 2, createdBy: "super person" });
        await call("DELETE", `/admin/analytics/exclusions/${added.body.data.id}`, "super");
    });

    integrationTest("exclusion rules are validated", async () => {
        const add = (body: unknown) => call("POST", "/admin/analytics/exclusions", "super", body);
        expect((await add({ kind: "REGISTRATION", value: ids.regs.trio.code, reason: "x" })).status).toBe(400);
        expect((await add({ kind: "EVERYTHING", value: "x", reason: "Because" })).status).toBe(400);
        expect((await add({ kind: "REGISTRATION", value: "not-an-id", reason: "Because" })).status).toBe(400);
        expect((await add({ kind: "REGISTRATION", value: "SG26-ZZZZZZZZ", reason: "Because" })).status).toBe(404);
        expect((await add({ kind: "ACCOUNT", value: "nobody@nowhere.example", reason: "Because" })).status).toBe(404);
        const first = await add({ kind: "REGISTRATION", value: ids.regs.trio.code, reason: "Because" });
        expect(first.status).toBe(201);
        expect((await add({ kind: "REGISTRATION", value: ids.regs.trio.code, reason: "Again" })).status).toBe(409);
        expect((await call("DELETE", `/admin/analytics/exclusions/${first.body.data.id}`, "super")).status).toBe(200);
        expect((await call("DELETE", `/admin/analytics/exclusions/${first.body.data.id}`, "super")).status).toBe(404);
    });

    integrationTest("suggestions point at organizer accounts and test email domains, but exclude nothing by themselves", async () => {
        const suggestions = (await call("GET", "/admin/analytics/suggestions", "super")).body.data;
        const organizer = suggestions.find((s: any) => s.value === `volunteer-${runId}@mvsr.test`);
        expect(organizer).toMatchObject({ signal: "strong", registrations: [ids.regs.organizer.code] });
        const qa = suggestions.find((s: any) => s.value === `qa-${runId}@example.com`);
        expect(qa.signal).toBe("weak");
        expect(qa.reasons[0]).toMatch(/example\.com/);
        expect(eventRow(await overview(), ids.soloEvent).excluded.registrations).toBe(0);
    });

    integrationTest("records can be searched, filtered, paged and exported with the same rules", async () => {
        const list = (query: string) => call("GET", `/admin/analytics/records?event=${ids.teamEvent}&${query}`, "super");
        expect((await list("q=" + ids.regs.trio.code.slice(0, 9))).body.data.records.map((r: any) => r.registrationId)).toContain(ids.regs.trio.code);
        expect((await list(`q=trio member 2`)).body.data.total).toBe(1);
        expect((await list("payment=PENDING")).body.data.records.map((r: any) => r.registrationId)).toEqual([ids.regs.review.code]);
        const page = (await list("pageSize=2&page=2")).body.data;
        expect(page).toMatchObject({ page: 2, pageSize: 2, total: 7 });
        expect(page.records).toHaveLength(2);
        // Junk values are ignored rather than breaking the query.
        expect((await call("GET", "/admin/analytics/records?scope=everything&page=-4&pageSize=99999&from=yesterday", "super")).status).toBe(200);

        const csv = await call("GET", `/admin/analytics/records.csv?event=${ids.teamEvent}`, "super");
        expect(csv.status).toBe(200);
        expect(csv.type).toContain("text/csv");
        const lines = csv.body.trim().split("\r\n");
        expect(lines[0].startsWith("Registration ID,Event")).toBe(true);
        expect(lines).toHaveLength(8);
    });

    integrationTest("messy rows in the sheet are reported and don't change the numbers", async () => {
        const before = eventRow(await overview(), ids.teamEvent).production;
        const grid = sheet.tabs.get(names.team)!;
        const header = grid[0] as string[];
        const copy = [...grid.find((row) => row[0] === ids.regs.trio.code)!];
        grid.push(copy, header.map((name) => (name === "teamName" ? "Typed by hand" : "")), ["SG26-BADBADBA", "x", "lots"]);
        sheet.gridOf(names.team).rowCount = grid.length;
        const data = await overview();
        const team = eventRow(data, ids.teamEvent);
        expect(team.quality).toMatchObject({ rowsWithoutId: 1, duplicateIds: [ids.regs.trio.code] });
        expect(team.quality.rowsWithProblems).toBe(1);
        expect(team.production.approvedTeams).toBe(before.approvedTeams);
        expect(data.dataQuality.duplicateIds).toContain(ids.regs.trio.code);
        grid.splice(grid.length - 3, 3);
    });

    integrationTest("if Google fails, the last read is shown marked stale; with no earlier read the error is clear", async () => {
        const good = await overview();
        expect(good.stale).toBe(false);
        sheet.failures.nextRead = Object.assign(new Error("backendError"), { code: 503, status: 503 });
        const stale = await call("GET", "/admin/overview", "super");
        expect(stale.status).toBe(200);
        expect(stale.body.data.stale).toBe(true);
        expect(stale.body.data.staleReason).toMatch(/last successful read/);
        expect(eventRow(stale.body.data, ids.teamEvent).production).toEqual(eventRow(good, ids.teamEvent).production);

        analytics.clearAnalyticsCache();
        sheet.failures.nextRead = Object.assign(new Error("backendError"), { code: 503, status: 503 });
        const down = await call("GET", "/admin/overview", "super");
        expect(down.status).toBe(503);
        expect(down.body.error.message).toBe("Couldn't read the Google Sheet right now. Try again in a minute.");
        expect(JSON.stringify(down.body)).not.toContain("backendError");
    });
});

describe("existing flows over HTTP (regression)", () => {
    integrationTest("health checks, public events, registration and payment proof still work end to end", async () => {
        expect((await call("GET", "/health")).body.data.status).toBe("ok");
        expect((await call("GET", "/health/ready")).body.data.database).toBe("ok");
        const events = (await call("GET", "/events")).body.data;
        expect(events.some((e: any) => e.id === ids.teamEvent)).toBe(true);

        await user("flow");
        const created = await call("POST", `/events/${ids.teamEvent}/registrations`, "flow", {
            teamName: "Flow Team",
            college: "Test College",
            phone: "+91 98765 43210",
            amountPaise: 1, // ignored: the server computes the fee
            participants: [
                { name: "Flow One", email: `flow1-${runId}@mvsr.test` },
                { name: "Flow Two", email: `flow2-${runId}@mvsr.test` },
            ],
        });
        expect(created.status).toBe(201);
        expect(created.body.data.amountPaise).toBe(20_000);
        const regId = created.body.data.id;

        const form = new FormData();
        form.append("utr", `FLOW${runId}`.toUpperCase());
        form.append("paymentMethod", "UPI");
        form.append("screenshot", new Blob([PNG], { type: "image/png" }), "pay.png");
        const proof = await fetch(`${base}/registrations/${regId}/payment-proofs`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenFor("flow")}` },
            body: form,
        });
        expect(proof.status).toBe(201);
        // A UTR is a claim: the registration waits for review, it is never approved by itself.
        const mine = (await call("GET", "/registrations/me", "flow")).body.data;
        expect(mine[0].status).toBe("PAYMENT_REVIEW");
        // The same UTR can't be used for another registration.
        const again = await fetch(`${base}/registrations/${regId}/payment-proofs`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenFor("flow")}` },
            body: form,
        });
        expect(again.status).toBe(409);
        // Someone else's registration stays private.
        expect((await call("GET", `/registrations/${regId}`, "alice")).status).toBe(403);
    });

    integrationTest("admin lists don't include the secret ticket codes", async () => {
        const pending = await call("GET", "/admin/registrations/pending", "volunteer");
        expect(pending.status).toBe(200);
        expect(JSON.stringify(pending.body)).not.toContain("ticketCode");
        const proof = pending.body.data[0]?.paymentProofs?.[0];
        if (proof) expect(JSON.stringify((await call("GET", `/admin/payment-proofs/${proof.id}`, "volunteer")).body)).not.toContain("ticketCode");
        expect(JSON.stringify((await call("GET", "/admin/registrations", "volunteer")).body)).not.toContain("ticketCode");
    });
});

describe("sign-in rate limits", () => {
    integrationTest("limits apply per account, so one campus network isn't locked out", async () => {
        const signin = (email: string) => call("POST", "/auth/signin", null, { email, password: "wrong-password-123" });
        // Ten wrong attempts for one account, then it's paused...
        for (let i = 0; i < 10; i++) expect((await signin(`victim-${runId}@mvsr.test`)).status).toBe(401);
        expect((await signin(`victim-${runId}@mvsr.test`)).status).toBe(429);
        // ...while other students on the same network can still sign in.
        for (let i = 0; i < 12; i++) expect((await signin(`student${i}-${runId}@mvsr.test`)).status).toBe(401);
    });
});
