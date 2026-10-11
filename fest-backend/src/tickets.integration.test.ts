// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Express } from "express";
import { prisma } from "./lib/prisma.ts";
import type { MailMessage } from "./lib/mailer.ts";
import * as registrations from "./RegistrationsService.ts";
import * as payments from "./PaymentVerificationService.ts";
import * as tickets from "./TicketService.ts";
import { registrationSheetRow, registrationSyncInclude } from "./lib/registrationSync.ts";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const runId = crypto.randomUUID().slice(0, 8);
const ids = { event: "", users: [] as string[], admin: "" };

function png(): Express.Multer.File {
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    return { buffer, size: buffer.length, mimetype: "image/png", originalname: "proof.png" } as Express.Multer.File;
}
async function expectError(promise: Promise<unknown>, statusCode: number, message?: RegExp) {
    try {
        await promise;
    } catch (error) {
        expect((error as { status?: number }).status).toBe(statusCode);
        if (message) expect((error as Error).message).toMatch(message);
        return;
    }
    throw new Error(`Expected a ${statusCode} error`);
}
// A registration paid and verified by an organizer, optionally approved.
async function verifiedTeam(label: string, size: number, approve = true) {
    const user = await prisma.user.create({
        data: { name: label, email: `${label}-${runId}@example.com`, passwordHash: "x" },
    });
    ids.users.push(user.id);
    const reg = await registrations.createRegistration(user.id, ids.event, {
        teamName: `Team ${label}`,
        college: "Test Institute of Technology",
        phone: "9876543210",
        participants: Array.from({ length: size }, (_, i) => ({
            name: `${label} member ${i + 1}`,
            email: `${label}-m${i + 1}-${runId}@example.com`,
        })),
    });
    await payments.submitProof(reg.id, user.id, `TKT${label}${runId}`.toUpperCase(), png());
    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { registrationId: reg.id, status: "PENDING" } });
    await payments.reviewProof(proof.id, ids.admin, "verify");
    if (approve) await registrations.approveRegistration(reg.id, ids.admin);
    return { reg, userId: user.id };
}
async function members(registrationId: string) {
    return prisma.participant.findMany({ where: { registrationId }, orderBy: { createdAt: "asc" } });
}
// Collects messages instead of sending them.
function fakeMailer(failFor?: string) {
    const sent: MailMessage[] = [];
    return {
        sent,
        send: async (message: MailMessage) => {
            if (failFor && message.to === failFor) throw new Error("550 mailbox unavailable");
            sent.push(message);
        },
    };
}
// Sends for one registration only: every other pending member in the database is parked
// (marked as in-flight) for the call and restored afterwards.
async function sendFor(registrationId: string, send: (m: MailMessage) => Promise<void>) {
    const others = await prisma.participant.findMany({
        where: { registrationId: { not: registrationId }, ticketEmailedAt: null },
        select: { id: true, ticketEmailAttemptAt: true },
    });
    await prisma.participant.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { ticketEmailAttemptAt: new Date() } });
    try {
        return await tickets.sendPendingTicketEmails({ send });
    } finally {
        for (const other of others)
            await prisma.participant.update({ where: { id: other.id }, data: { ticketEmailAttemptAt: other.ticketEmailAttemptAt } });
    }
}

beforeAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const event = await prisma.event.create({
        data: {
            name: `Ticket test ${runId}`,
            slug: `ticket-test-${runId}`,
            feePaise: 15_000,
            feeMode: "PER_HEAD",
            minTeamSize: 1,
            maxTeamSize: 3,
            isPublished: true,
        },
    });
    ids.event = event.id;
    const admin = await prisma.user.create({
        data: { name: "Gate Admin", email: `gate-admin-${runId}@example.com`, passwordHash: "x", role: "ADMIN" },
    });
    ids.admin = admin.id;
    ids.users.push(admin.id);
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const regs = await prisma.registration.findMany({ where: { eventId: ids.event }, select: { id: true, code: true } });
    const regIds = regs.map((r) => r.id);
    const memberIds = (await prisma.participant.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } })).map((p) => p.id);
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { entityId: { in: memberIds } } });
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.paymentProof.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { entityId: { in: [...regIds, ...regs.map((r) => r.code)] } } });
    await prisma.event.delete({ where: { id: ids.event } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
});

test("ticket codes are read from the QR text or typed by hand, and anything else is refused", () => {
    const code = "0123456789abcdef0123456789abcdef";
    // The QR holds only the opaque ticket ID, never a link or personal data.
    expect(tickets.ticketQrText(code)).toBe(`SHOURYA26:${code}`);
    expect(tickets.parseTicketCode(tickets.ticketQrText(code))).toBe(code);
    // QR codes emailed while the QR was briefly a link still scan.
    expect(tickets.parseTicketCode(`https://shouryacse.site/admin?ticket=${code}`)).toBe(code);
    expect(tickets.parseTicketCode(` ${code.toUpperCase()} `)).toBe(code);
    expect(tickets.parseTicketCode("https://shouryacse.site/admin")).toBeNull();
    expect(tickets.parseTicketCode("SHOURYA26:not-a-code")).toBeNull();
    expect(tickets.parseTicketCode("https://example.com")).toBeNull();
    expect(tickets.parseTicketCode(42)).toBeNull();
});

integrationTest("every member gets a unique ticket code, and nothing is emailed before approval", async () => {
    const { reg } = await verifiedTeam("noapprove", 3, false);
    const team = await members(reg.id);
    expect(new Set(team.map((m) => m.ticketCode)).size).toBe(3);
    expect(team.every((m) => /^[0-9a-f]{32}$/.test(m.ticketCode))).toBe(true);
    const mail = fakeMailer();
    await sendFor(reg.id, mail.send);
    expect(mail.sent).toHaveLength(0);
    // A verified but unapproved team can't enter.
    const scan = await tickets.scanTicket(team[0].ticketCode);
    expect(scan.admission).toBe("NOT_APPROVED");
    await expectError(tickets.admitParticipant(team[0].id, ids.admin), 409, /isn't approved/);
});

integrationTest("approval emails each member their own QR, then marks the tickets issued", async () => {
    const { reg } = await verifiedTeam("mail", 3);
    const mail = fakeMailer();
    const result = await sendFor(reg.id, mail.send);
    expect(result.sent).toBe(3);
    expect(mail.sent.map((m) => m.to).sort()).toEqual(
        [1, 2, 3].map((i) => `mail-m${i}-${runId}@example.com`).sort(),
    );
    const first = mail.sent.find((m) => m.to === `mail-m1-${runId}@example.com`)!;
    expect(first.subject).toContain(`Ticket test ${runId}`);
    expect(first.html).toContain("mail member 1");
    expect(first.html).toContain("cid:ticket-qr");
    // Every member's email carries the team's registration ID (subject, highlighted box, text).
    for (const message of mail.sent) {
        expect(message.subject).toContain(reg.code);
        expect(message.html).toContain("REGISTRATION ID");
        expect(message.html).toContain(reg.code);
        expect(message.text).toContain(`Registration ID: ${reg.code}`);
    }
    expect(first.attachments?.[0].cid).toBe("ticket-qr");
    // The attachment is a real PNG.
    expect(first.attachments?.[0].content.subarray(1, 4).toString()).toBe("PNG");

    const after = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id }, include: registrationSyncInclude });
    expect(after.status).toBe("TICKET_ISSUED");
    expect(registrationSheetRow(after).emailStatus).toBe("SENT 3/3");
    const actions = (await registrations.getAuditHistory(reg.id)).map((a) => a.action);
    expect(actions.at(-1)).toBe("TICKETS_EMAILED");

    // Already-emailed members aren't emailed again.
    const again = fakeMailer();
    await sendFor(reg.id, again.send);
    expect(again.sent).toHaveLength(0);
});

integrationTest("a failed email is recorded, retried later, and the team stays approved until it goes out", async () => {
    const { reg } = await verifiedTeam("retry", 2);
    const failing = fakeMailer(`retry-m2-${runId}@example.com`);
    const result = await sendFor(reg.id, failing.send);
    expect(result.sent).toBe(1);
    expect(result.failed).toHaveLength(1);
    let row = registrationSheetRow(
        await prisma.registration.findUniqueOrThrow({ where: { id: reg.id }, include: registrationSyncInclude }),
    );
    expect(row.emailStatus).toMatch(/^FAILED \(1\/2 sent\): 550/);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe("APPROVED");

    // After the retry window the failed member is tried again.
    await prisma.participant.updateMany({
        where: { registrationId: reg.id, ticketEmailedAt: null },
        data: { ticketEmailAttemptAt: new Date(Date.now() - 10 * 60_000) },
    });
    const working = fakeMailer();
    await sendFor(reg.id, working.send);
    expect(working.sent.map((m) => m.to)).toEqual([`retry-m2-${runId}@example.com`]);
    row = registrationSheetRow(
        await prisma.registration.findUniqueOrThrow({ where: { id: reg.id }, include: registrationSyncInclude }),
    );
    expect(row.emailStatus).toBe("SENT 2/2");
});

integrationTest("scanning shows the member and event, admits them once, and the team counts as entered", async () => {
    const { reg } = await verifiedTeam("gate", 2);
    const [a, b] = await members(reg.id);

    const scan = await tickets.scanTicket(tickets.ticketQrText(a.ticketCode));
    expect(scan.admission).toBe("ALLOWED");
    expect(scan.participant.name).toBe("gate member 1");
    expect(scan.event.name).toBe(`Ticket test ${runId}`);
    expect(scan.registration.teamName).toBe("Team gate");
    expect(scan.teammates.map((t) => t.name)).toEqual(["gate member 1", "gate member 2"]);

    const admitted = await tickets.admitParticipant(a.id, ids.admin);
    expect(admitted.admission).toBe("ALREADY_ENTERED");
    expect(admitted.participant.checkedInBy).toBe("Gate Admin");
    // The same QR can't be used for a second band.
    await expectError(tickets.admitParticipant(a.id, ids.admin), 409, /already entered/);
    expect((await tickets.scanTicket(a.ticketCode)).admission).toBe("ALREADY_ENTERED");

    const team = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id }, include: registrationSyncInclude });
    expect(team.entered).toBe(true);
    expect(team.enteredById).toBe(ids.admin);
    expect(registrationSheetRow(team).checkedIn).toBe("1/2 entered");

    // The teammate's own QR still works.
    expect((await tickets.scanTicket(b.ticketCode)).admission).toBe("ALLOWED");
    await tickets.admitParticipant(b.id, ids.admin);
    const audit = (await registrations.getAuditHistory(reg.id)).filter((e) => e.action === "MEMBER_CHECKED_IN");
    expect(audit.map((e) => e.detail)).toEqual(["gate member 1 entered (ticket scanned)", "gate member 2 entered (ticket scanned)"]);
});

integrationTest("unknown or malformed QR codes are refused", async () => {
    await expectError(tickets.scanTicket("SHOURYA26:ffffffffffffffffffffffffffffffff"), 404, /isn't a valid/);
    await expectError(tickets.scanTicket("hello"), 400, /isn't a SHOURYA'26 ticket/);
});

integrationTest("a rejected registration's tickets no longer admit anyone", async () => {
    const { reg } = await verifiedTeam("rejected", 1);
    await registrations.rejectRegistration(reg.id, ids.admin, "Duplicate entry found");
    const [member] = await members(reg.id);
    expect((await tickets.scanTicket(member.ticketCode)).admission).toBe("NOT_APPROVED");
    await expectError(tickets.admitParticipant(member.id, ids.admin), 409);
});

integrationTest("only the team's own account or an organizer can open its QR images, and only after approval", async () => {
    const pending = await verifiedTeam("imgpending", 1, false);
    const [pendingMember] = await members(pending.reg.id);
    await expectError(tickets.ticketImage(pending.reg.id, pendingMember.id, pending.userId, false), 409, /after the organizers approve/);

    const { reg, userId } = await verifiedTeam("img", 2);
    const [member] = await members(reg.id);
    const image = await tickets.ticketImage(reg.id, member.id, userId, false);
    expect(image.subarray(1, 4).toString()).toBe("PNG");
    await expectError(tickets.ticketImage(reg.id, member.id, pending.userId, false), 403);
    expect((await tickets.ticketImage(reg.id, member.id, ids.admin, true)).length).toBeGreaterThan(100);
    // A participant ID from another registration isn't accepted.
    await expectError(tickets.ticketImage(reg.id, pendingMember.id, userId, false), 404);
});

// A team that has submitted its payment proof but hasn't been reviewed yet.
async function teamInPaymentReview(label: string, size: number) {
    const user = await prisma.user.create({
        data: { name: label, email: `${label}-${runId}@example.com`, passwordHash: "x" },
    });
    ids.users.push(user.id);
    const reg = await registrations.createRegistration(user.id, ids.event, {
        teamName: `Team ${label}`,
        college: "Test Institute of Technology",
        phone: "9876543210",
        participants: Array.from({ length: size }, (_, i) => ({
            name: `${label} member ${i + 1}`,
            email: `${label}-m${i + 1}-${runId}@example.com`,
        })),
    });
    await payments.submitProof(reg.id, user.id, `TKT${label}${runId}`.toUpperCase(), png());
    return reg;
}
async function latestParticipantRow(participantId: string) {
    const entry = await prisma.spreadsheetSyncOutbox.findFirstOrThrow({
        where: { entityType: "PARTICIPANT", entityId: participantId },
        orderBy: { createdAt: "desc" },
    });
    return entry.payload as Record<string, string>;
}

integrationTest("one Approve click verifies the pending payment, approves, and the tickets follow", async () => {
    const reg = await teamInPaymentReview("oneclick", 2);
    const result = await registrations.approveWithPayment(reg.id, ids.admin);
    expect(result.alreadyApproved).toBe(false);
    expect(result.registration.status).toBe("APPROVED");
    expect(result.registration.verified).toBe(true);
    expect(await prisma.paymentProof.count({ where: { registrationId: reg.id, status: "VERIFIED" } })).toBe(1);
    expect((await registrations.getAuditHistory(reg.id)).map((a) => a.action)).toEqual([
        "REGISTERED",
        "PAYMENT_SUBMITTED",
        "PAYMENT_VERIFIED",
        "APPROVED",
    ]);
    // A second click is harmless.
    expect((await registrations.approveWithPayment(reg.id, ids.admin)).alreadyApproved).toBe(true);

    const mail = fakeMailer();
    await sendFor(reg.id, mail.send);
    expect(mail.sent.map((m) => m.to).sort()).toEqual([`oneclick-m1-${runId}@example.com`, `oneclick-m2-${runId}@example.com`]);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).status).toBe("TICKET_ISSUED");
});

integrationTest("Approve refuses a team that hasn't submitted a payment", async () => {
    const user = await prisma.user.create({ data: { name: "nopay", email: `nopay-${runId}@example.com`, passwordHash: "x" } });
    ids.users.push(user.id);
    const reg = await registrations.createRegistration(user.id, ids.event, {
        teamName: "Team nopay",
        college: "Test Institute of Technology",
        phone: "9876543210",
        participants: [{ name: "nopay member", email: `nopay-m1-${runId}@example.com` }],
    });
    await expectError(registrations.approveWithPayment(reg.id, ids.admin), 409, /Verify the payment/);
});

integrationTest("each member's own Participants sheet row shows their ticket email and entry", async () => {
    const reg = await teamInPaymentReview("rows", 2);
    const [a, b] = await members(reg.id);
    expect((await latestParticipantRow(a.id)).ticketEmailStatus).toBe("NOT_SENT");
    await registrations.approveWithPayment(reg.id, ids.admin);
    const mail = fakeMailer(`rows-m2-${runId}@example.com`);
    await sendFor(reg.id, mail.send);

    const rowA = await latestParticipantRow(a.id);
    expect(rowA.participantName).toBe("rows member 1");
    expect(rowA.email).toBe(`rows-m1-${runId}@example.com`);
    expect(rowA.ticketEmailStatus).toBe("SENT");
    expect(rowA.ticketEmailedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rowA.checkedInAt).toBe("");
    expect((await latestParticipantRow(b.id)).ticketEmailStatus).toMatch(/^FAILED: 550/);

    await tickets.admitParticipant(a.id, ids.admin);
    expect((await latestParticipantRow(a.id)).checkedInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

integrationTest("the first scan admits the member and uses up the QR; later scans show it as already scanned", async () => {
    const { reg } = await verifiedTeam("autoscan", 2);
    const [a] = await members(reg.id);
    const first = await tickets.scanTicket(tickets.ticketQrText(a.ticketCode), ids.admin);
    expect(first.justAdmitted).toBe(true);
    expect(first.admission).toBe("ALREADY_ENTERED");
    expect(first.participant.name).toBe("autoscan member 1");
    expect(first.event.name).toBe(`Ticket test ${runId}`);
    expect(first.participant.checkedInBy).toBe("Gate Admin");

    const again = await tickets.scanTicket(tickets.ticketQrText(a.ticketCode), ids.admin);
    expect(again.justAdmitted).toBe(false);
    expect(again.admission).toBe("ALREADY_ENTERED");
    expect(again.participant.checkedInAt).toEqual(first.participant.checkedInAt);
    expect((await registrations.getAuditHistory(reg.id)).filter((e) => e.action === "MEMBER_CHECKED_IN")).toHaveLength(1);

    // An unapproved team's QR is never admitted by scanning.
    const pending = await verifiedTeam("autoscanpending", 1, false);
    const [p] = await members(pending.reg.id);
    const refused = await tickets.scanTicket(p.ticketCode, ids.admin);
    expect(refused.admission).toBe("NOT_APPROVED");
    expect(refused.justAdmitted).toBe(false);
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: p.id } })).checkedInAt).toBeNull();
});

integrationTest("two organizers scanning the same QR at the same moment admit the member exactly once", async () => {
    const { reg } = await verifiedTeam("race", 1);
    const [member] = await members(reg.id);
    const second = await prisma.user.create({
        data: { name: "Second Gate", email: `second-gate-${runId}@example.com`, passwordHash: "x", role: "ADMIN" },
    });
    ids.users.push(second.id);
    const results = await Promise.all([
        tickets.scanTicket(member.ticketCode, ids.admin, "scan-race-aaaa"),
        tickets.scanTicket(member.ticketCode, second.id, "scan-race-bbbb"),
        tickets.scanTicket(member.ticketCode, ids.admin, "scan-race-cccc"),
    ]);
    expect(results.filter((r) => r.justAdmitted)).toHaveLength(1);
    expect(results.every((r) => r.admission === "ALREADY_ENTERED")).toBe(true);
    expect((await registrations.getAuditHistory(reg.id)).filter((e) => e.action === "MEMBER_CHECKED_IN")).toHaveLength(1);
});

integrationTest("a network retry of the same scan gets its original result; a new scan is reported as already scanned", async () => {
    const { reg } = await verifiedTeam("retryscan", 1);
    const [member] = await members(reg.id);
    const first = await tickets.scanTicket(member.ticketCode, ids.admin, "scan-retry-1111");
    expect(first.justAdmitted).toBe(true);
    const retried = await tickets.scanTicket(member.ticketCode, ids.admin, "scan-retry-1111");
    expect(retried.justAdmitted).toBe(true);
    expect(retried.participant.checkedInAt).toEqual(first.participant.checkedInAt);
    const newScan = await tickets.scanTicket(member.ticketCode, ids.admin, "scan-retry-2222");
    expect(newScan.justAdmitted).toBe(false);
    expect(newScan.admission).toBe("ALREADY_ENTERED");
    // The original check-in time is never overwritten.
    expect(newScan.participant.checkedInAt).toEqual(first.participant.checkedInAt);
});

integrationTest("only signed-in organizers get past the scan API's guards", async () => {
    const { authenticate } = await import("./middleware/authenticate.ts");
    const { requireAdmin } = await import("./middleware/requireAdmin.ts");
    const users = await import("./UserService.ts");
    const email = `plain-user-${runId}@example.com`;
    await users.signup("Plain User", email, "plain-user-password-123");
    const { token } = await users.signin(email, "plain-user-password-123");
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    ids.users.push(created.id);

    // Runs authenticate then requireAdmin like the route does; returns the HTTP status or "passed".
    async function guard(authorization?: string) {
        const req = { header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined) } as never;
        let status = 0;
        const res = { status: (code: number) => ((status = code), res), json: () => res } as never;
        let passed = false;
        await (authenticate as (rq: never, rs: never, next: () => void) => Promise<void>)(req, res, () => {
            requireAdmin(req, res, () => {
                passed = true;
            });
        });
        return passed ? "passed" : status;
    }
    expect(await guard()).toBe(401);
    expect(await guard("Bearer not-a-real-token")).toBe(401);
    expect(await guard(`Bearer ${token}`)).toBe(403);
    await prisma.user.update({ where: { id: created.id }, data: { role: "ADMIN" } });
    expect(await guard(`Bearer ${token}`)).toBe("passed");
});
