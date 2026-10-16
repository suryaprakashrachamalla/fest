// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Express } from "express";
import { prisma } from "./lib/prisma.ts";
import type { MailMessage } from "./lib/mailer.ts";
import * as registrations from "./RegistrationsService.ts";
import * as payments from "./PaymentVerificationService.ts";
import * as tickets from "./TicketService.ts";
import { openPassword, portalSites, sealPassword, sendPendingPortalLogins, type PortalClient, type PortalMember } from "./PortalService.ts";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const runId = crypto.randomUUID().slice(0, 8);
const ids = { event: "", otherEvent: "", users: [] as string[], admin: "" };
const BASE = "https://portal.example.test";
// The test event's portal; `otherEvent` has none unless a test adds it.
const sites = () => [{ slug: `portal-test-${runId}`, url: BASE, adminPassword: "x" }];

function png(): Express.Multer.File {
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    return { buffer, size: buffer.length, mimetype: "image/png", originalname: "proof.png" } as Express.Multer.File;
}
// An approved, paid team, so its members can be checked in at the gate.
async function approvedTeam(label: string, size: number, eventId = ids.event) {
    const user = await prisma.user.create({ data: { name: label, email: `${label}-${runId}@example.com`, passwordHash: "x" } });
    ids.users.push(user.id);
    const reg = await registrations.createRegistration(user.id, eventId, {
        teamName: `Team ${label}`,
        college: "Test Institute of Technology",
        phone: "9876543210",
        participants: Array.from({ length: size }, (_, i) => ({
            name: `${label} member ${i + 1}`,
            email: `${label}-m${i + 1}-${runId}@example.com`,
        })),
    });
    await payments.submitProof(reg.id, user.id, `PTL${label}${runId}`.toUpperCase(), png());
    const proof = await prisma.paymentProof.findFirstOrThrow({ where: { registrationId: reg.id, status: "PENDING" } });
    await payments.reviewProof(proof.id, ids.admin, "verify");
    await registrations.approveRegistration(reg.id, ids.admin);
    return reg;
}
async function members(registrationId: string) {
    return prisma.participant.findMany({ where: { registrationId }, orderBy: { createdAt: "asc" } });
}
// Records calls instead of reaching a real portal; `down` makes every call fail.
function fakePortal() {
    const state = { down: false, created: [] as { name: string; college: string }[], resets: [] as number[], updates: [] as { teamId: number; members: PortalMember[]; checked_in: boolean }[] };
    let next = 1;
    const portal: PortalClient = {
        async createTeam(input) {
            if (state.down) throw new Error("connect ECONNREFUSED");
            state.created.push(input);
            const n = next++;
            return { login: `VYOM-${String(n).padStart(3, "0")}`, password: `pass-${n}-${runId}`, teamId: n };
        },
        async resetPassword(teamId) {
            if (state.down) throw new Error("connect ECONNREFUSED");
            state.resets.push(teamId);
            return `reset-${teamId}-${runId}`;
        },
        async updateTeam(teamId, data) {
            if (state.down) throw new Error("connect ECONNREFUSED");
            state.updates.push({ teamId, members: data.members, checked_in: data.checked_in });
        },
    };
    return { state, portal };
}
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
// Makes a failed team due for its retry now instead of after the claim timeout.
async function expireClaim(registrationId: string) {
    await prisma.registration.update({ where: { id: registrationId }, data: { portalAttemptAt: new Date(Date.now() - 10 * 60_000) } });
}

beforeAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const make = (slug: string) =>
        prisma.event.create({
            data: { name: `Portal test ${slug}`, slug, feePaise: 29_900, feeMode: "PER_HEAD", minTeamSize: 1, maxTeamSize: 4, isPublished: true },
        });
    ids.event = (await make(`portal-test-${runId}`)).id;
    ids.otherEvent = (await make(`portal-other-${runId}`)).id;
    // Only this run's events have portals (passed as `sites`), so other data in the database is never touched.
    const admin = await prisma.user.create({ data: { name: "Gate Admin", email: `portal-admin-${runId}@example.com`, passwordHash: "x", role: "ADMIN" } });
    ids.admin = admin.id;
    ids.users.push(admin.id);
});

afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") return;
    const regs = await prisma.registration.findMany({ where: { eventId: { in: [ids.event, ids.otherEvent] } }, select: { id: true, code: true } });
    const regIds = regs.map((r) => r.id);
    const memberIds = (await prisma.participant.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } })).map((p) => p.id);
    await prisma.spreadsheetSyncOutbox.deleteMany({ where: { entityId: { in: [...memberIds, ...regIds, ...regs.map((r) => r.code), ids.event, ids.otherEvent] } } });
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.paymentProof.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.event.deleteMany({ where: { id: { in: [ids.event, ids.otherEvent] } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
});

test("portal passwords are stored encrypted and read back, and a damaged value reads as missing", () => {
    process.env.JWT_SECRET ||= "test-only-jwt-secret-0123456789-abcdefghij";
    const sealed = sealPassword("abcd-efgh");
    expect(sealed).not.toContain("abcd-efgh");
    expect(openPassword(sealed)).toBe("abcd-efgh");
    expect(openPassword(`${sealed.slice(0, -2)}xx`)).toBeNull();
    expect(openPassword(null)).toBeNull();
});

integrationTest("the first gate scan of a team creates one portal login and emails it to every member", async () => {
    const reg = await approvedTeam("scan", 3);
    const { state, portal } = fakePortal();
    const mail = fakeMailer();

    // Nobody has entered yet: no login is made.
    expect(await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: mail.send })).toEqual({ teams: 0, emailed: 0, failed: [] });

    const [first, second] = await members(reg.id);
    await tickets.admitParticipant(first.id, ids.admin);
    const result = await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: mail.send });
    expect(result).toEqual({ teams: 1, emailed: 3, failed: [] });

    // One portal team, with the members copied over and checked in there.
    expect(state.created).toEqual([{ name: "Team scan", college: "Test Institute of Technology" }]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].checked_in).toBe(true);
    expect(state.updates[0].members.map((m) => m.name)).toEqual(["scan member 1", "scan member 2", "scan member 3"]);

    // Every member, not only the one scanned, gets the same team ID and password.
    expect(mail.sent.map((m) => m.to).sort()).toEqual((await members(reg.id)).map((m) => m.email).sort());
    for (const message of mail.sent) {
        expect(message.text).toContain("Team ID: VYOM-001");
        expect(message.text).toContain(`Password: pass-1-${runId}`);
        expect(message.text).toContain(BASE);
    }
    const saved = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } });
    expect(saved.portalLogin).toBe("VYOM-001");
    expect(saved.portalPassword).not.toContain(`pass-1-${runId}`);
    expect(saved.portalError).toBeNull();
    expect((await members(reg.id)).every((m) => m.portalEmailedAt)).toBe(true);

    // The next member entering, or the next run, sends nothing again and makes no second login.
    await tickets.admitParticipant(second.id, ids.admin);
    expect(await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: mail.send })).toEqual({ teams: 0, emailed: 0, failed: [] });
    expect(state.created).toHaveLength(1);
    expect(mail.sent).toHaveLength(3);
});

integrationTest("a failed email is retried later for that member only, with the same password", async () => {
    const reg = await approvedTeam("bounce", 2);
    const [first, second] = await members(reg.id);
    const { state, portal } = fakePortal();
    const failing = fakeMailer(second.email);

    await tickets.admitParticipant(first.id, ids.admin);
    const result = await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: failing.send });
    expect(result.emailed).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).portalError).toContain("550 mailbox unavailable");

    // Within the retry window the team is left alone.
    const working = fakeMailer();
    expect((await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: working.send })).teams).toBe(0);

    await expireClaim(reg.id);
    expect(await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: working.send })).toEqual({ teams: 1, emailed: 1, failed: [] });
    expect(working.sent.map((m) => m.to)).toEqual([second.email]);
    expect(working.sent[0].text).toContain(failing.sent[0].text.match(/Password: .*/)![0]);
    expect(state.created).toHaveLength(1);
    expect(state.updates).toHaveLength(1);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).portalError).toBeNull();
});

integrationTest("when the portal is down nothing is emailed, and the login is made once it is back", async () => {
    const reg = await approvedTeam("down", 1);
    const [only] = await members(reg.id);
    const { state, portal } = fakePortal();
    const mail = fakeMailer();
    state.down = true;

    await tickets.admitParticipant(only.id, ids.admin);
    const result = await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: mail.send });
    expect(result.emailed).toBe(0);
    expect(result.failed[0].error).toContain("ECONNREFUSED");
    expect(mail.sent).toHaveLength(0);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).portalLogin).toBeNull();

    state.down = false;
    await expireClaim(reg.id);
    expect(await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: mail.send })).toEqual({ teams: 1, emailed: 1, failed: [] });
    expect(mail.sent[0].to).toBe(only.email);
    // A solo entrant's email doesn't talk about teammates.
    expect(mail.sent[0].text).toContain("This login is for you.");
});

integrationTest("an unreadable stored password is reset on the portal and sent to the whole team again", async () => {
    const reg = await approvedTeam("reset", 2);
    const [first] = await members(reg.id);
    const { state, portal } = fakePortal();
    await tickets.admitParticipant(first.id, ids.admin);
    await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: fakeMailer().send });
    const saved = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } });

    // e.g. JWT_SECRET changed: the stored password can't be decrypted any more.
    await prisma.participant.update({ where: { id: first.id }, data: { portalEmailedAt: null } });
    await prisma.registration.update({ where: { id: reg.id }, data: { portalPassword: "damaged" } });
    const mail = fakeMailer();
    expect(await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: mail.send })).toEqual({ teams: 1, emailed: 2, failed: [] });
    expect(state.resets).toEqual([saved.portalTeamId!]);
    expect(mail.sent.every((m) => m.text.includes(`Password: reset-${saved.portalTeamId}-${runId}`))).toBe(true);
});

integrationTest("teams of other events get no portal login", async () => {
    const reg = await approvedTeam("other", 1, ids.otherEvent);
    const [only] = await members(reg.id);
    await tickets.admitParticipant(only.id, ids.admin);
    const { state, portal } = fakePortal();
    await sendPendingPortalLogins({ sites: sites(), clientFor: () => portal, send: fakeMailer().send });
    expect(state.created).toHaveLength(0);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).portalLogin).toBeNull();
});

test("portals are read from PORTAL_* and PORTAL<n>_* settings, and incomplete ones are left out", () => {
    expect(
        portalSites({
            PORTAL_URL: "https://www.shouryacse.site/",
            PORTAL_ADMIN_PASSWORD: "a",
            PORTAL2_URL: "https://www.shouryacse.site/vibeathon",
            PORTAL2_ADMIN_PASSWORD: "b",
            PORTAL2_EVENT_SLUG: "no-code-vibathon",
            // No event named, so no third portal.
            PORTAL3_URL: "https://example.test",
            PORTAL3_ADMIN_PASSWORD: "c",
        }),
    ).toEqual([
        { slug: "hackathon", url: "https://www.shouryacse.site", adminPassword: "a" },
        { slug: "no-code-vibathon", url: "https://www.shouryacse.site/vibeathon", adminPassword: "b" },
    ]);
    expect(portalSites({ PORTAL_URL: "https://www.shouryacse.site" })).toEqual([]);
});

integrationTest("each event's teams get their login from that event's own portal", async () => {
    const hack = await approvedTeam("hack2", 1);
    const vibe = await approvedTeam("vibe2", 2, ids.otherEvent);
    const portals = { hack: fakePortal(), vibe: fakePortal() };
    const both = [...sites(), { slug: `portal-other-${runId}`, url: `${BASE}/vibeathon`, adminPassword: "y" }];
    for (const reg of [hack, vibe]) await tickets.admitParticipant((await members(reg.id))[0].id, ids.admin);
    const mail = fakeMailer();
    await sendPendingPortalLogins({ sites: both, clientFor: (site) => (site.url === BASE ? portals.hack : portals.vibe).portal, send: mail.send });

    // (The vibeathon portal also catches up on the other event's team checked in by an earlier test.)
    expect(portals.hack.state.created.map((t) => t.name)).toEqual(["Team hack2"]);
    expect(portals.vibe.state.created.map((t) => t.name)).toContain("Team vibe2");
    expect(portals.vibe.state.created.map((t) => t.name)).not.toContain("Team hack2");
    // The vibeathon members are pointed at the vibeathon portal.
    const vibeMails = mail.sent.filter((m) => (m.to as string).startsWith("vibe2-"));
    expect(vibeMails).toHaveLength(2);
    expect(vibeMails.every((m) => m.text.includes(`Portal: ${BASE}/vibeathon`))).toBe(true);
});
