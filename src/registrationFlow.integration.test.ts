// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Express } from "express";
import { prisma } from "./lib/prisma.ts";
import * as registrations from "./RegistrationsService.ts";
import * as payments from "./PaymentVerificationService.ts";
import * as checkIn from "./CheckInService.ts";
import { registrationSheetRow, registrationSyncInclude } from "./lib/registrationSync.ts";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const runId = crypto.randomUUID().slice(0, 8);
const ids = { event: "", users: [] as string[], admin: "" };

function png(): Express.Multer.File {
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    return { buffer, size: buffer.length, mimetype: "image/png", originalname: "proof.png" } as Express.Multer.File;
}
function team(prefix: string, size = 2) {
    return {
        teamName: `Team ${prefix}`,
        college: "Test Institute of Technology",
        phone: "98765 43210",
        participants: Array.from({ length: size }, (_, i) => ({
            name: `Student ${i + 1}`,
            email: `${prefix}-s${i + 1}-${runId}@example.com`,
        })),
    };
}
async function newUser(label: string) {
    const user = await prisma.user.create({
        data: { name: label, email: `${label}-${runId}@example.com`, passwordHash: "x" },
    });
    ids.users.push(user.id);
    return user.id;
}
async function status(id: string) {
    return (await prisma.registration.findUniqueOrThrow({ where: { id } })).status;
}
async function pendingProofId(registrationId: string) {
    return (await prisma.paymentProof.findFirstOrThrow({ where: { registrationId, status: "PENDING" } })).id;
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

beforeAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const event = await prisma.event.create({
        data: {
            name: `Flow test ${runId}`,
            slug: `flow-test-${runId}`,
            feePaise: 39_900,
            feeMode: "PER_HEAD",
            minTeamSize: 2,
            maxTeamSize: 3,
            isPublished: true,
        },
    });
    ids.event = event.id;
    const admin = await prisma.user.create({
        data: { name: "Admin", email: `admin-${runId}@example.com`, passwordHash: "x", role: "ADMIN" },
    });
    ids.admin = admin.id;
    ids.users.push(admin.id);
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const regs = await prisma.registration.findMany({ where: { eventId: ids.event }, select: { id: true } });
    const regIds = regs.map((r) => r.id);
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.paymentProof.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { entityId: { in: regIds } } });
    await prisma.event.delete({ where: { id: ids.event } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
});

integrationTest("successful registration computes the per-head fee server-side and starts in PENDING_PAYMENT", async () => {
    const userId = await newUser("ok");
    const reg = await registrations.createRegistration(userId, ids.event, { ...team("ok", 3), amountPaise: 1 } as never);
    expect(reg.code).toMatch(/^SG26-[2-9A-HJ-NP-Z]{8}$/);
    expect(reg.amountPaise).toBe(3 * 39_900);
    expect(reg.status).toBe("PENDING_PAYMENT");
    expect(reg.phone).toBe("+919876543210");
    expect(reg.participants.map((p) => p.email)).toEqual([
        `ok-s1-${runId}@example.com`,
        `ok-s2-${runId}@example.com`,
        `ok-s3-${runId}@example.com`,
    ]);
    const audit = await registrations.getAuditHistory(reg.id);
    expect(audit.map((a) => a.action)).toEqual(["REGISTERED"]);
    const outbox = await prisma.spreadsheetSyncOutbox.findFirstOrThrow({
        where: { entityType: "REGISTRATION", entityId: reg.id },
    });
    expect((outbox.payload as { registrationId: string }).registrationId).toBe(reg.code);
});

integrationTest("invalid registrations are rejected with clear messages", async () => {
    const userId = await newUser("invalid");
    await expectError(registrations.createRegistration(userId, ids.event, { ...team("inv"), phone: "12345" }), 400, /mobile/);
    const badEmail = team("inv");
    badEmail.participants[1].email = "not-an-email";
    await expectError(registrations.createRegistration(userId, ids.event, badEmail), 400, /Student 2.*email/);
    const sameEmail = team("inv");
    sameEmail.participants[1].email = sameEmail.participants[0].email;
    await expectError(registrations.createRegistration(userId, ids.event, sameEmail), 400, /different email/);
    await expectError(registrations.createRegistration(userId, ids.event, team("inv", 1)), 400, /between 2 and 3/);
    await expectError(
        registrations.createRegistration(userId, ids.event, { ...team("inv"), college: "MVSR Engineering College" }),
        400,
        /roll numbers/,
    );
});

integrationTest("duplicate registrations are blocked for the same account and for the same student email", async () => {
    const userA = await newUser("dupa");
    const userB = await newUser("dupb");
    await registrations.createRegistration(userA, ids.event, team("dup"));
    await expectError(registrations.createRegistration(userA, ids.event, team("dup2")), 409, /already registered/);
    await expectError(registrations.createRegistration(userB, ids.event, team("dup")), 409, /students is already registered/);
});

integrationTest("a submitted UTR alone never verifies payment, approves, or admits the team", async () => {
    const userId = await newUser("utr");
    const reg = await registrations.createRegistration(userId, ids.event, team("utr"));
    await payments.submitProof(reg.id, userId, `UTR${runId}A1`, png());
    expect(await status(reg.id)).toBe("PAYMENT_REVIEW");
    await expectError(payments.submitProof(reg.id, userId, `UTR${runId}A2`, png()), 409, /already pending/);
    // A UTR that was already used on another registration is refused.
    const other = await registrations.createRegistration(await newUser("utr2"), ids.event, team("utr2"));
    await expectError(payments.submitProof(other.id, other.userId, `UTR${runId}A1`, png()), 409, /UTR has already been submitted/);
    await expectError(registrations.approveRegistration(reg.id, ids.admin), 409, /Verify the payment/);
    await expectError(checkIn.checkIn(reg.id, ids.admin), 409);
});

integrationTest("payment rejection allows a resubmission, then verification and approval", async () => {
    const userId = await newUser("flow");
    const reg = await registrations.createRegistration(userId, ids.event, team("flow"));
    await payments.submitProof(reg.id, userId, `UTR${runId}B1`, png());
    await expectError(payments.reviewProof(await pendingProofId(reg.id), ids.admin, "reject"), 400, /reason/);
    await payments.reviewProof(await pendingProofId(reg.id), ids.admin, "reject", "Amount does not match");
    expect(await status(reg.id)).toBe("PAYMENT_REJECTED");

    await payments.submitProof(reg.id, userId, `UTR${runId}B2`, png());
    expect(await status(reg.id)).toBe("PAYMENT_REVIEW");
    const verified = await payments.reviewProof(await pendingProofId(reg.id), ids.admin, "verify");
    expect(verified.registration.status).toBe("PAYMENT_VERIFIED");

    const first = await registrations.approveRegistration(reg.id, ids.admin);
    expect(first.alreadyApproved).toBe(false);
    expect(first.registration.status).toBe("APPROVED");
    expect(first.registration.entryAllowed).toBe(true);

    // Duplicate approval clicks are harmless and do not add audit entries.
    const second = await registrations.approveRegistration(reg.id, ids.admin);
    expect(second.alreadyApproved).toBe(true);
    const actions = (await registrations.getAuditHistory(reg.id)).map((a) => a.action);
    expect(actions).toEqual([
        "REGISTERED",
        "PAYMENT_SUBMITTED",
        "PAYMENT_REJECTED",
        "PAYMENT_SUBMITTED",
        "PAYMENT_VERIFIED",
        "APPROVED",
    ]);

    // Duplicate check-in attempts are refused.
    await checkIn.checkIn(reg.id, ids.admin);
    await expectError(checkIn.checkIn(reg.id, ids.admin), 409, /already checked in/);
});

integrationTest("rejecting a registration closes its pending proof and records the reason", async () => {
    const userId = await newUser("rej");
    const reg = await registrations.createRegistration(userId, ids.event, team("rej"));
    await payments.submitProof(reg.id, userId, `UTR${runId}C1`, png());
    await expectError(registrations.rejectRegistration(reg.id, ids.admin, "no"), 400);
    const rejected = await registrations.rejectRegistration(reg.id, ids.admin, "Duplicate team entry");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Duplicate team entry");
    expect(await prisma.paymentProof.count({ where: { registrationId: reg.id, status: "PENDING" } })).toBe(0);
    await expectError(registrations.rejectRegistration(reg.id, ids.admin, "Again please"), 409);
    await expectError(payments.submitProof(reg.id, userId, `UTR${runId}C2`, png()), 409);
});

integrationTest("the Registrations sheet row has the expected columns", async () => {
    const userId = await newUser("sheet");
    const reg = await registrations.createRegistration(userId, ids.event, team("sheet"));
    const full = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id }, include: registrationSyncInclude });
    const row = registrationSheetRow(full);
    expect(Object.keys(row)).toEqual([
        "registrationId", "internalId", "participantNames", "emails", "phone", "college", "event",
        "teamName", "teamSize", "registrationFee", "paymentMethod", "utr", "paymentStatus",
        "approvalStatus", "status", "rejectionReason", "paymentVerifiedBy", "paymentVerifiedAt",
        "approvedBy", "approvedAt", "rejectedBy", "registeredAt", "lumaGuestId", "ticketStatus",
        "emailStatus", "checkedIn", "checkedInAt", "updatedAt",
    ]);
    expect(row.registrationFee).toBe("798.00");
    expect(row.paymentStatus).toBe("NOT_SUBMITTED");
    expect(row.approvalStatus).toBe("PENDING");
});
