// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { prisma } from "./lib/prisma.ts";
import * as registrations from "./RegistrationsService.ts";
import { ticketEmail } from "./TicketService.ts";

// Fee models and individual (team-less) registration, on throwaway events shaped like the real ones.
const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const runId = crypto.randomUUID().slice(0, 8);
const ids = { perHead: "", flat: "", solo: "", users: [] as string[] };

async function newUser(label: string) {
    const user = await prisma.user.create({ data: { name: label, email: `${label}-${runId}@example.com`, passwordHash: "x" } });
    ids.users.push(user.id);
    return user.id;
}
function people(prefix: string, count: number) {
    return Array.from({ length: count }, (_, i) => ({ name: `${prefix} person ${i + 1}`, email: `${prefix}-p${i + 1}-${runId}@example.com` }));
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
    const base = { isPublished: true, description: null };
    // Like NOCODE VIBEATHON: ₹300 per participant, 1–2 members.
    ids.perHead = (await prisma.event.create({ data: { ...base, name: `Per head ${runId}`, slug: `per-head-${runId}`, feePaise: 30_000, feeMode: "PER_HEAD", minTeamSize: 1, maxTeamSize: 2 } })).id;
    // A flat team fee, regardless of team size.
    ids.flat = (await prisma.event.create({ data: { ...base, name: `Flat ${runId}`, slug: `flat-${runId}`, feePaise: 50_000, feeMode: "FLAT", minTeamSize: 1, maxTeamSize: 3 } })).id;
    // Like GitHub Workshop / Standup Comedy: one person per registration.
    ids.solo = (await prisma.event.create({ data: { ...base, name: `Solo ${runId}`, slug: `solo-${runId}`, feePaise: 15_000, feeMode: "PER_HEAD", minTeamSize: 1, maxTeamSize: 1 } })).id;
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const eventIds = [ids.perHead, ids.flat, ids.solo];
    const regs = await prisma.registration.findMany({ where: { eventId: { in: eventIds } }, select: { id: true, code: true } });
    const regIds = regs.map((r) => r.id);
    const memberIds = (await prisma.participant.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } })).map((p) => p.id);
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { entityId: { in: [...regIds, ...regs.map((r) => r.code), ...memberIds] } } });
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
});

integrationTest("per-participant fees multiply by team size: 1 × ₹300 = ₹300, 2 × ₹300 = ₹600", async () => {
    const one = await registrations.createRegistration(await newUser("ph1"), ids.perHead, {
        teamName: "Solo maker", college: "Test College", phone: "9876543210", participants: people("ph1", 1),
    });
    expect(one.amountPaise).toBe(30_000);
    const two = await registrations.createRegistration(await newUser("ph2"), ids.perHead, {
        teamName: "Duo makers", college: "Test College", phone: "9876543210", participants: people("ph2", 2),
        // A client-sent total is never used.
        amountPaise: 1,
    } as never);
    expect(two.amountPaise).toBe(60_000);
});

integrationTest("flat fees stay the same whatever the team size", async () => {
    for (const size of [1, 3]) {
        const reg = await registrations.createRegistration(await newUser(`flat${size}`), ids.flat, {
            teamName: `Flat team ${size}`, college: "Test College", phone: "9876543210", participants: people(`flat${size}`, size),
        });
        expect(reg.amountPaise).toBe(50_000);
    }
});

integrationTest("individual events register without a team name; team events still require one", async () => {
    const solo = await registrations.createRegistration(await newUser("solo"), ids.solo, {
        college: "Test College", phone: "9876543210", participants: people("solo", 1),
    });
    expect(solo.teamName).toBeNull();
    expect(solo.amountPaise).toBe(15_000);
    // A team name sent for an individual event is ignored rather than stored.
    const named = await registrations.createRegistration(await newUser("solo2"), ids.solo, {
        teamName: "Should not be stored", college: "Test College", phone: "9876543210", participants: people("solo2", 1),
    });
    expect(named.teamName).toBeNull();
    // Individual events still accept exactly one person.
    await expectError(
        registrations.createRegistration(await newUser("solo3"), ids.solo, { college: "Test College", phone: "9876543210", participants: people("solo3", 2) }),
        400,
        /between 1 and 1/,
    );
    // Team events keep the team-name requirement.
    await expectError(
        registrations.createRegistration(await newUser("team"), ids.perHead, { college: "Test College", phone: "9876543210", participants: people("team", 2) }),
        400,
        /team name/,
    );
});

test("ticket emails for individual registrations don't mention a team", () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const solo = ticketEmail({ name: "Asha", teamName: null, code: "SG26-ABCDEFGH", eventName: "GitHub Workshop", eventSlug: "github-workshop", teamSize: 1, ticketCode: "0".repeat(32) }, png);
    expect(solo.text).toContain("Your registration for GitHub Workshop is approved");
    expect(solo.html).toContain("Your registration for <strong>GitHub Workshop</strong> is approved");
    expect(solo.text).not.toContain("Your team");
    expect(solo.html).not.toContain("your team");
    const team = ticketEmail({ name: "Ravi", teamName: "Byte Squad", code: "SG26-ABCDEFGH", eventName: "Hackathon", eventSlug: "hackathon", teamSize: 3, ticketCode: "0".repeat(32) }, png);
    expect(team.text).toContain('Your team "Byte Squad" is approved for Hackathon');
});
