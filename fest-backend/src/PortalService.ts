import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./lib/prisma.ts";
import { addAudit } from "./lib/registrationSync.ts";
import { mailConfigured, sendMail as smtpSendMail, type MailMessage, type SendMail } from "./lib/mailer.ts";
import { jwtSecret } from "./UserService.ts";

// Hackathon portal logins handed out at the gate. The VYOM hackathon portal (the separate app behind
// PORTAL_URL, e.g. https://www.shouryacse.site) signs teams in with a team ID like VYOM-012 and a
// password. When the first member of a hackathon team is checked in at the entrance (QR scan or
// registration-ID lookup), this worker:
//   1. creates the team's login on the portal through its admin API (POST /api/admin/teams/generate),
//   2. copies the team name, college and members there and marks the team checked in, and
//   3. emails that same team ID and password to every member of the team.
// The portal app itself is untouched: this only calls the admin API it already has.
//
//   PORTAL_URL             the portal's address, e.g. https://www.shouryacse.site
//   PORTAL_ADMIN_PASSWORD  the portal's admin password (its ADMIN_PASSWORD)
//   PORTAL_EVENT_SLUG      the event whose teams get logins (default "hackathon")

// A team whose attempt hasn't finished within this window is retried.
const CLAIM_TIMEOUT_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

function portalUrl() {
    return (process.env.PORTAL_URL?.trim() ?? "").replace(/\/$/, "");
}

export function portalEventSlug() {
    return process.env.PORTAL_EVENT_SLUG?.trim() || "hackathon";
}

export function portalConfigured() {
    return Boolean(portalUrl() && process.env.PORTAL_ADMIN_PASSWORD?.trim());
}

export type PortalMember = { name: string; email: string };

// The portal's admin API, injectable so tests never reach a real portal.
export type PortalClient = {
    createTeam(input: { name: string; college: string }): Promise<{ login: string; password: string; teamId: number }>;
    resetPassword(teamId: number): Promise<string>;
    updateTeam(teamId: number, data: { name: string; college: string; members: PortalMember[]; checked_in: boolean }): Promise<void>;
};

export function httpPortalClient(baseUrl = portalUrl(), adminPassword = process.env.PORTAL_ADMIN_PASSWORD?.trim() ?? ""): PortalClient {
    let cookie: string | null = null;

    async function signIn() {
        const response = await fetch(`${baseUrl}/api/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: adminPassword }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Portal admin sign-in failed (HTTP ${response.status})`);
        const sid = response.headers
            .getSetCookie()
            .map((value) => /^admin_sid=([^;]+)/.exec(value)?.[1])
            .find(Boolean);
        if (!sid) throw new Error("Portal admin sign-in returned no session");
        cookie = `admin_sid=${sid}`;
    }

    // Signs in on first use and again once if the session has expired.
    async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (!cookie) await signIn();
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: { Cookie: cookie!, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (response.status === 401 && attempt === 0) {
                cookie = null;
                continue;
            }
            const json = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) throw new Error(`Portal ${method} ${path} failed (HTTP ${response.status})${json.error ? `: ${json.error}` : ""}`);
            return json as T;
        }
        throw new Error("Portal admin session was refused");
    }

    return {
        async createTeam({ name, college }) {
            const created = await call<{ credentials?: { login: string; password: string }[] }>("/api/admin/teams/generate", "POST", {
                rows: [{ name, college }],
            });
            const credential = created.credentials?.[0];
            if (!credential?.login || !credential.password) throw new Error("Portal didn't return a team login");
            // The generate call returns only the login; the team's numeric ID comes from the admin state.
            const state = await call<{ teams?: { id: number; login: string }[] }>("/api/admin/state", "GET");
            const team = state.teams?.find((t) => t.login.toUpperCase() === credential.login.toUpperCase());
            if (!team) throw new Error(`Portal team ${credential.login} wasn't found after creating it`);
            return { login: credential.login, password: credential.password, teamId: team.id };
        },
        async resetPassword(teamId) {
            const reset = await call<{ password?: string }>(`/api/admin/teams/${teamId}/reset`, "POST");
            if (!reset.password) throw new Error("Portal didn't return a new password");
            return reset.password;
        },
        async updateTeam(teamId, data) {
            await call(`/api/admin/teams/${teamId}`, "PUT", data);
        },
    };
}

// The password is stored encrypted (AES-256-GCM, key derived from JWT_SECRET) so a member whose email
// failed can be sent the same password later without resetting it for the whole team.
function cipherKey() {
    return createHash("sha256").update(`portal-login:${jwtSecret()}`).digest();
}

export function sealPassword(password: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
    const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")).join(".");
}

// Null when the value can't be read (e.g. JWT_SECRET changed); the caller then resets the password.
export function openPassword(sealed: string | null) {
    if (!sealed) return null;
    try {
        const [iv, tag, data] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
        const decipher = createDecipheriv("aes-256-gcm", cipherKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type PortalEmailInput = {
    name: string;
    teamName: string | null;
    code: string;
    eventName: string;
    login: string;
    password: string;
    teamSize: number;
    portalUrl: string;
};

export function portalLoginEmail(input: PortalEmailInput): Omit<MailMessage, "to"> {
    const shared =
        input.teamSize > 1
            ? `Every member of your team has received this same team ID and password, so any of you can sign in.`
            : "This login is for you.";
    const team = input.teamName ? ` for your team "${input.teamName}"` : "";
    const credentialRow = (label: string, value: string) =>
        `<tr><td style="padding:6px 0;font-size:12px;letter-spacing:2px;color:#8a6d2b;width:110px">${label}</td><td style="padding:6px 0;font-size:20px;font-weight:bold;color:#1d1a14;font-family:'Courier New',monospace">${escapeHtml(value)}</td></tr>`;
    return {
        subject: `Your ${input.eventName} portal login: ${input.login} (${input.code})`,
        text: [
            `Hi ${input.name},`,
            "",
            `Welcome to ${input.eventName}! You're checked in. Here is the hackathon portal login${team}:`,
            "",
            `Portal: ${input.portalUrl}`,
            `Team ID: ${input.login}`,
            `Password: ${input.password}`,
            "",
            shared,
            "Sign in to see the timetable and announcements, choose your problem statement, claim your team perk and submit your project.",
            "Please don't share this login outside your team.",
            "",
            `Registration ID: ${input.code}`,
        ].join("\n"),
        html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1d1a14">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6dcc4">
<tr><td style="background:#0b0a08;padding:22px 24px;text-align:center">
<div style="color:#f3d27a;font-size:13px;font-weight:bold;letter-spacing:4px">SHOURYA'26</div>
<div style="color:#f3d27a;font-size:24px;font-weight:bold;letter-spacing:2px;margin-top:6px">${escapeHtml(input.eventName)}</div>
<div style="color:#bfb39a;font-size:11px;margin-top:6px">Hackathon portal login</div>
</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:16px">Hi <strong>${escapeHtml(input.name)}</strong>,</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.5">Welcome! You're checked in. Here is the hackathon portal login${input.teamName ? ` for your team <strong>${escapeHtml(input.teamName)}</strong>` : ""}.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;padding:12px 16px;border:1px dashed #d9a93f;border-radius:10px;background:#fbf6ea">
${credentialRow("TEAM ID", input.login)}
${credentialRow("PASSWORD", input.password)}
</table>
<p style="margin:0 0 10px;font-size:14px;line-height:1.5">${escapeHtml(shared)}</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.5">Sign in to see the timetable and announcements, choose your problem statement, claim your team perk and submit your project. Please don't share this login outside your team.</p>
<p style="margin:0 0 18px;text-align:center"><a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#d9a93f;color:#0b0a08;text-decoration:none;font-weight:bold;padding:10px 20px;border-radius:999px">Open the hackathon portal</a></p>
<p style="margin:0;text-align:center;font-size:12px;color:#8a8170">Registration ID: ${escapeHtml(input.code)}</p>
</td></tr></table></body></html>`,
    };
}

type PortalResult = { teams: number; emailed: number; failed: { code: string; error: string }[] };

// Gives every entered hackathon team its portal login and emails it to members who don't have it yet.
// `portal` and `send` are injectable so tests never reach a real portal or mail server.
export async function sendPendingPortalLogins({
    portal = httpPortalClient(),
    send = smtpSendMail,
    baseUrl = portalUrl(),
    limit = 50,
}: { portal?: PortalClient; send?: SendMail; baseUrl?: string; limit?: number } = {}) {
    const result: PortalResult = { teams: 0, emailed: 0, failed: [] };
    const stale = () => new Date(Date.now() - CLAIM_TIMEOUT_MS);
    const waiting = {
        entered: true,
        event: { slug: portalEventSlug() },
        OR: [{ portalSyncedAt: null }, { participants: { some: { portalEmailedAt: null } } }],
    };
    const pending = await prisma.registration.findMany({
        where: { ...waiting, AND: [{ OR: [{ portalAttemptAt: null }, { portalAttemptAt: { lt: stale() } }] }] },
        select: { id: true },
        orderBy: { enteredAt: "asc" },
        take: limit,
    });

    for (const { id } of pending) {
        const claimed = await prisma.registration.updateMany({
            where: { id, ...waiting, AND: [{ OR: [{ portalAttemptAt: null }, { portalAttemptAt: { lt: stale() } }] }] },
            data: { portalAttemptAt: new Date() },
        });
        if (claimed.count !== 1) continue;
        const reg = await prisma.registration.findUniqueOrThrow({
            where: { id },
            include: { event: true, participants: { orderBy: { createdAt: "asc" } } },
        });
        result.teams++;
        const errors: string[] = [];
        try {
            let login = reg.portalLogin;
            let teamId = reg.portalTeamId;
            let password = openPassword(reg.portalPassword);
            let unsent = reg.participants.filter((p) => !p.portalEmailedAt);
            if (!login || teamId === null) {
                const created = await portal.createTeam({ name: (reg.teamName || reg.code).slice(0, 60), college: reg.college.slice(0, 120) });
                ({ login, teamId, password } = created);
                // Saved straight away, so a failure further on never creates a second login for this team.
                await prisma.registration.update({
                    where: { id },
                    data: { portalLogin: login, portalTeamId: teamId, portalPassword: sealPassword(password) },
                });
            } else if (!password) {
                // The stored password can't be read, so give the team a new one and send it to everyone.
                password = await portal.resetPassword(teamId);
                await prisma.$transaction([
                    prisma.registration.update({ where: { id }, data: { portalPassword: sealPassword(password) } }),
                    prisma.participant.updateMany({ where: { registrationId: id }, data: { portalEmailedAt: null } }),
                ]);
                unsent = reg.participants;
            }
            if (!reg.portalSyncedAt) {
                // Only once: the portal's team update also resets its review status and note.
                await portal.updateTeam(teamId, {
                    name: (reg.teamName || reg.code).slice(0, 60),
                    college: reg.college.slice(0, 120),
                    members: reg.participants.map((p) => ({ name: p.name.slice(0, 60), email: p.email.slice(0, 120) })),
                    checked_in: true,
                });
                await prisma.registration.update({ where: { id }, data: { portalSyncedAt: new Date() } });
                await prisma.$transaction(async (tx) => {
                    await addAudit(tx, {
                        registrationId: id,
                        action: "PORTAL_LOGIN_CREATED",
                        detail: `Hackathon portal login ${login} created and the team checked in there`,
                    });
                });
            }
            for (const member of unsent) {
                try {
                    const message = portalLoginEmail({
                        name: member.name,
                        teamName: reg.teamName,
                        code: reg.code,
                        eventName: reg.event.name,
                        login,
                        password,
                        teamSize: reg.participants.length,
                        portalUrl: baseUrl,
                    });
                    await send({ to: member.email, ...message });
                    await prisma.participant.update({ where: { id: member.id }, data: { portalEmailedAt: new Date() } });
                    result.emailed++;
                } catch (error) {
                    errors.push(`${member.email}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
        // Success frees the claim; a failure keeps it so the team is retried after CLAIM_TIMEOUT_MS.
        const error = errors.length ? errors.join("; ").slice(0, 500) : null;
        await prisma.registration.update({
            where: { id },
            data: error ? { portalError: error } : { portalError: null, portalAttemptAt: null },
        });
        if (error) result.failed.push({ code: reg.code, error });
    }
    return result;
}

export async function portalLoginStatus() {
    const event = { entered: true, event: { slug: portalEventSlug() } };
    const [teams, withLogin, pending, failed] = await Promise.all([
        prisma.registration.count({ where: event }),
        prisma.registration.count({ where: { ...event, portalLogin: { not: null } } }),
        prisma.participant.count({ where: { portalEmailedAt: null, registration: event } }),
        prisma.registration.count({ where: { ...event, portalError: { not: null } } }),
    ]);
    return { configured: portalConfigured(), eventSlug: portalEventSlug(), enteredTeams: teams, teamsWithLogin: withLogin, membersNotEmailed: pending, teamsFailing: failed };
}

let runNow: (() => Promise<void>) | undefined;

// Hands out portal logins on an interval once the portal and email are configured. Returns a stop function.
export function startPortalLoginWorker() {
    if (!portalConfigured()) {
        console.warn("Hackathon portal isn't configured (PORTAL_URL, PORTAL_ADMIN_PASSWORD): portal logins are off.");
        return () => {};
    }
    if (!mailConfigured()) console.warn("Email isn't configured: portal logins are created but can't be emailed yet.");
    const interval = Math.max(10_000, Number(process.env.PORTAL_LOGIN_INTERVAL_MS) || 20_000);
    const portal = httpPortalClient();
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await sendPendingPortalLogins({ portal });
            if (result.emailed) console.info(`Portal: emailed ${result.emailed} hackathon portal login(s)`);
            for (const failure of result.failed) console.error(`Portal: ${failure.code} failed: ${failure.error}`);
        } catch (error) {
            console.error("Portal logins failed:", error instanceof Error ? error.message : error);
        } finally {
            running = false;
        }
    };
    runNow = tick;
    const timer = setInterval(() => void tick(), interval);
    void tick();
    console.info(`Hackathon portal logins on (every ${Math.round(interval / 1000)}s) for ${portalUrl()}`);
    return () => {
        clearInterval(timer);
        runNow = undefined;
    };
}

// Lets a gate check-in hand out the login right away instead of waiting for the next tick.
export function sendPortalLoginsSoon() {
    const tick = runNow;
    if (tick) setTimeout(() => void tick(), 500);
}
