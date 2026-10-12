// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { prisma } from "./lib/prisma.ts";
import { eventOverview, requireSuperAdmin, superAdminEmails } from "./OverviewService.ts";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const runId = crypto.randomUUID().slice(0, 8);
const ids = { event: "", user: "" };

test("super admins are the ADMIN_SUPER*_EMAIL accounts, case-insensitive", () => {
    const emails = superAdminEmails({
        ADMIN_SUPER_EMAIL: "Lead@Example.com",
        ADMIN_SUPER3_EMAIL: " third@example.com ",
        ADMIN_VOLUNTEER1_EMAIL: "volunteer@example.com",
        ADMIN_SUPERX_EMAIL: "not-a-super@example.com",
    });
    expect([...emails].sort()).toEqual(["lead@example.com", "third@example.com"]);
});

test("only super admins get past the overview guard", () => {
    const previous = process.env.ADMIN_SUPER_EMAIL;
    process.env.ADMIN_SUPER_EMAIL = "lead@example.com";
    const run = (email: string) => {
        let status = 0;
        let passed = false;
        const res = { status: (code: number) => ((status = code), res), json: () => res } as never;
        requireSuperAdmin({ user: { id: "1", name: "x", email, role: "ADMIN" } } as never, res, () => {
            passed = true;
        });
        return passed ? "passed" : status;
    };
    expect(run("LEAD@example.com")).toBe("passed");
    expect(run("volunteer@example.com")).toBe(403);
    process.env.ADMIN_SUPER_EMAIL = previous;
});

beforeAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const event = await prisma.event.create({
        data: { name: `Overview ${runId}`, slug: `overview-${runId}`, feePaise: 10_000, feeMode: "PER_HEAD", maxTeamSize: 3, isPublished: true },
    });
    ids.event = event.id;
    const user = await prisma.user.create({ data: { name: "Overview", email: `overview-${runId}@example.com`, passwordHash: "x" } });
    ids.user = user.id;
    // One registration per account and event, so each status uses its own account.
    const rows: [string, number][] = [["APPROVED", 3], ["PAYMENT_VERIFIED", 2], ["PAYMENT_REVIEW", 1], ["PENDING_PAYMENT", 2]];
    for (const [i, [status, size]] of rows.entries()) {
        const owner = i === 0 ? user.id : (await prisma.user.create({ data: { name: `O${i}`, email: `overview-${i}-${runId}@example.com`, passwordHash: "x" } })).id;
        await prisma.registration.create({
            data: {
                code: `OV${runId}${i}`,
                userId: owner,
                eventId: event.id,
                teamName: `Team ${i}`,
                teamSize: size,
                college: "Test College",
                phone: "+919876543210",
                amountPaise: size * 10_000,
                status: status as never,
            },
        });
    }
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const regs = await prisma.registration.findMany({ where: { eventId: ids.event }, select: { userId: true } });
    await prisma.registration.deleteMany({ where: { eventId: ids.event } });
    await prisma.event.delete({ where: { id: ids.event } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ...regs.map((r) => r.userId)] } } });
    await prisma.$disconnect();
});

integrationTest("the overview counts each event's teams, people and money collected", async () => {
    const { events, totals } = await eventOverview();
    const row = events.find((e) => e.eventId === ids.event)!;
    expect(row.registrations).toBe(4);
    expect(row.participants).toBe(8);
    expect(row.paidRegistrations).toBe(2);
    expect(row.paidParticipants).toBe(5);
    expect(row.collectedPaise).toBe(50_000);
    expect(row.awaitingReviewPaise).toBe(10_000);
    expect(row.byStatus).toEqual({ APPROVED: 1, PAYMENT_VERIFIED: 1, PAYMENT_REVIEW: 1, PENDING_PAYMENT: 1 });
    expect(totals.registrations).toBeGreaterThanOrEqual(4);
});
