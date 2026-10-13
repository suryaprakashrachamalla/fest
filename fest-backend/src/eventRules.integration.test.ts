// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { prisma } from "./lib/prisma.ts";
import * as registrations from "./RegistrationsService.ts";
import { ticketEmail } from "./TicketService.ts";

// Fee models and individual (team-less) registration, on throwaway events shaped like the real ones.
const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const runId = crypto.randomUUID().slice(0, 8);
const ids = { perHead: "", flat: "", solo: "", tiered: "", users: [] as string[] };

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
    // Like Standup Comedy: a single ticket (₹299) or a group of 5 (₹999), nothing in between.
    ids.tiered = (await prisma.event.create({ data: { ...base, name: `Tiered ${runId}`, slug: `tiered-${runId}`, feePaise: 29_900, feeMode: "FLAT", minTeamSize: 1, maxTeamSize: 5, feeTiers: [{ size: 1, feePaise: 29_900, label: "Single" }, { size: 5, feePaise: 99_900, label: "Group of 5" }] } })).id;
    ids.solo = (await prisma.event.create({ data: { ...base, name: `Solo ${runId}`, slug: `solo-${runId}`, feePaise: 15_000, feeMode: "PER_HEAD", minTeamSize: 1, maxTeamSize: 1 } })).id;
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const eventIds = [ids.perHead, ids.flat, ids.solo, ids.tiered];
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

integrationTest("ticket options: single ₹299 without a team name, group of 5 ₹999 with one, other sizes refused", async () => {
    const single = await registrations.createRegistration(await newUser("t1"), ids.tiered, {
        teamName: "ignored", college: "Test College", phone: "9876543210", participants: people("t1", 1), amountPaise: 1,
    } as never);
    expect(single.amountPaise).toBe(29_900);
    expect(single.teamName).toBeNull();
    const group = await registrations.createRegistration(await newUser("t5"), ids.tiered, {
        teamName: "Front Row", college: "Test College", phone: "9876543210", participants: people("t5", 5),
    });
    expect(group.amountPaise).toBe(99_900);
    expect(group.teamName).toBe("Front Row");
    expect(group.participants).toHaveLength(5);
    await expectError(
        registrations.createRegistration(await newUser("t3"), ids.tiered, { teamName: "Three", college: "Test College", phone: "9876543210", participants: people("t3", 3) }),
        400,
        /Single \(1 person\) or Group of 5 \(5 people\)/,
    );
    await expectError(
        registrations.createRegistration(await newUser("t5n"), ids.tiered, { college: "Test College", phone: "9876543210", participants: people("t5n", 5) }),
        400,
        /team name/,
    );
    // Other events keep their limit of 4.
    await expectError(
        registrations.createRegistration(await newUser("ph5"), ids.perHead, { teamName: "Five", college: "Test College", phone: "9876543210", participants: people("ph5", 5) }),
        400,
    );
});


integrationTest("team codes take ₹50 off once, only for their own event", async () => {
    const make = (code: string, eventId: string) => prisma.discountCode.create({ data: { code, eventId, amountPaise: 5_000 } });
    const tag = runId.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "X").padEnd(4, "X").slice(0, 4);
    await make(`HK-AAAA${tag}`, ids.perHead);
    await make(`HK-BBBB${tag}`, ids.perHead);
    await make(`NC-CCCC${tag}`, ids.flat);
    const register = async (label: string, eventId: string, teamCode: unknown, size = 2, extra: Record<string, unknown> = {}) =>
        registrations.createRegistration(await newUser(label), eventId, {
            teamName: `Team ${label}`, college: "Test College", phone: "9876543210", participants: people(label, size), teamCode, ...extra,
        } as never);

    // Typed in lower case with spaces still works; a discount or amount sent by the browser is ignored.
    const discounted = await register("tc1", ids.perHead, `  hk-aaaa${tag.toLowerCase()} `, 2, { discountPaise: 99_999, amountPaise: 1 });
    expect(discounted.amountPaise).toBe(60_000 - 5_000);
    expect(discounted.discountCode).toBe(`HK-AAAA${tag}`);
    expect(discounted.discountPaise).toBe(5_000);
    expect(discounted.paymentInstructions.amountPaise).toBe(55_000);

    // Used once already.
    await expectError(register("tc2", ids.perHead, `HK-AAAA${tag}`), 409, /already been used/);
    // Another event's code, or something that isn't a code.
    await expectError(register("tc3", ids.perHead, `NC-CCCC${tag}`), 400, /isn't valid for this event/);
    await expectError(register("tc4", ids.perHead, "FREE50"), 400, /isn't valid/);
    // No code: full price.
    expect((await register("tc5", ids.perHead, "")).amountPaise).toBe(60_000);
    // Checking before submitting.
    expect(await registrations.checkTeamCode(ids.perHead, `hk-bbbb${tag}`)).toEqual({ code: `HK-BBBB${tag}`, discountPaise: 5_000 });
    await expectError(registrations.checkTeamCode(ids.flat, `HK-BBBB${tag}`), 400);
});

integrationTest("two teams using the same code at once: only one gets it", async () => {
    const tag = runId.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "X").padEnd(4, "X").slice(0, 4);
    await prisma.discountCode.create({ data: { code: `HK-DDDD${tag}`, eventId: ids.perHead, amountPaise: 5_000 } });
    const attempt = async (label: string) =>
        registrations
            .createRegistration(await newUser(label), ids.perHead, {
                teamName: `Team ${label}`, college: "Test College", phone: "9876543210", participants: people(label, 1), teamCode: `HK-DDDD${tag}`,
            })
            .then((r) => r.amountPaise, (e) => (e as { status?: number }).status);
    const results = await Promise.all([attempt("race1"), attempt("race2")]);
    expect(results.sort()).toEqual([25_000, 409]);
    expect(await prisma.registration.count({ where: { discountCode: `HK-DDDD${tag}` } })).toBe(1);
});

integrationTest("rejecting a registration frees its team code for another team", async () => {
    const tag = runId.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "X").padEnd(4, "X").slice(0, 4);
    await prisma.discountCode.create({ data: { code: `HK-EEEE${tag}`, eventId: ids.perHead, amountPaise: 5_000 } });
    const organizer = await newUser("organizer");
    const first = await registrations.createRegistration(await newUser("rej1"), ids.perHead, {
        teamName: "First", college: "Test College", phone: "9876543210", participants: people("rej1", 1), teamCode: `HK-EEEE${tag}`,
    });
    await registrations.rejectRegistration(first.id, organizer, "Duplicate team");
    const second = await registrations.createRegistration(await newUser("rej2"), ids.perHead, {
        teamName: "Second", college: "Test College", phone: "9876543210", participants: people("rej2", 1), teamCode: `HK-EEEE${tag}`,
    });
    expect(second.amountPaise).toBe(25_000);
    // The rejected registration still shows the code it had used.
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: first.id } })).discountCode).toBe(`HK-EEEE${tag}`);
});
