import QRCode from "qrcode";
import { prisma } from "./lib/prisma.ts";
import { addAudit, queueParticipantSync, queueRegistrationSync } from "./lib/registrationSync.ts";
import { mailConfigured, sendMail as smtpSendMail, type MailMessage, type SendMail } from "./lib/mailer.ts";
import type { Prisma, RegistrationStatus } from "./generated/prisma/client.ts";

// Every team member gets their own entrance ticket once an organizer approves the registration.
// The QR holds only an opaque ticket ID, "SHOURYA26:<ticketCode>" (no personal data). Organizers
// scan it with the scanner inside the signed-in admin portal, which sends it to the admin-only
// scan API; the first valid scan records the entry and every later scan reports "already scanned".
// The QR is deliberately not a link: a phone camera would open it in a browser without the admin
// session and ask for credentials, and the ticket ID would end up in browser history.
const QR_PREFIX = "SHOURYA26:";
// A member whose email attempt hasn't finished within this window is retried.
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const TICKETED: RegistrationStatus[] = ["APPROVED", "TICKET_ISSUED"];
const SITE_URL = (process.env.PUBLIC_SITE_URL?.trim() || "https://shouryacse.site").replace(/\/$/, "");

function httpError(status: number, message: string) {
    return Object.assign(new Error(message), { status });
}

export function ticketQrText(code: string) {
    return `${QR_PREFIX}${code}`;
}

// Accepts the scanned "SHOURYA26:<code>", the bare 32-character code typed in, or the
// <site>/admin?ticket=<code> link that QR codes emailed on 12 Oct 2026 briefly used.
export function parseTicketCode(raw: unknown) {
    if (typeof raw !== "string") return null;
    let value = raw.trim();
    if (/^https?:\/\//i.test(value)) {
        try {
            value = new URL(value).searchParams.get("ticket") ?? "";
        } catch {
            return null;
        }
    } else if (value.toUpperCase().startsWith(QR_PREFIX)) value = value.slice(QR_PREFIX.length);
    value = value.trim();
    return /^[0-9a-f]{32}$/i.test(value) ? value.toLowerCase() : null;
}

export function ticketQrPng(code: string) {
    return QRCode.toBuffer(ticketQrText(code), { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" });
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type TicketEmailInput = {
    name: string;
    teamName: string;
    code: string;
    eventName: string;
    eventSlug: string;
    teamSize: number;
    ticketCode: string;
};

export function ticketEmail(input: TicketEmailInput, qrPng: Buffer): Omit<MailMessage, "to"> {
    const eventUrl = `${SITE_URL}/events/${input.eventSlug}`;
    const others =
        input.teamSize > 1
            ? `Each of your ${input.teamSize} team members has received their own QR by email.`
            : "This QR is just for you.";
    const h = {
        name: escapeHtml(input.name),
        team: escapeHtml(input.teamName),
        event: escapeHtml(input.eventName),
        code: escapeHtml(input.code),
    };
    return {
        subject: `Your SHOURYA'26 entry ticket - ${input.eventName}`,
        text: [
            `Hi ${input.name},`,
            "",
            `Your team "${input.teamName}" is approved for ${input.eventName} at SHOURYA'26, Department of Computer Science, MVSR.`,
            "",
            "Your personal entry QR code is attached. Show it at the entrance: the organizers scan it, check your name and give you your band.",
            `The QR admits only you and works once. ${others} Please don't share it.`,
            "",
            `Registration: ${input.code}`,
            `Ticket code (if the QR can't be scanned): ${input.ticketCode}`,
            `Event details: ${eventUrl}`,
            "",
            "See you at SHOURYA'26!",
        ].join("\n"),
        html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f1e8;font-family:Arial,Helvetica,sans-serif;color:#1d1a14">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6dcc4">
<tr><td style="background:#0b0a08;padding:22px 24px;text-align:center">
<div style="color:#d9a93f;font-size:12px;letter-spacing:3px">DEPARTMENT OF COMPUTER SCIENCE · MVSR</div>
<div style="color:#f3d27a;font-size:26px;font-weight:bold;letter-spacing:2px;margin-top:6px">SHOURYA'26</div>
</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:16px">Hi <strong>${h.name}</strong>,</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.5">Your team <strong>${h.team}</strong> is approved for <strong>${h.event}</strong>. This is your personal entry ticket.</p>
<div style="text-align:center;margin:0 0 14px"><img src="cid:ticket-qr" width="240" height="240" alt="Your entry QR code" style="display:inline-block;border:8px solid #ffffff;box-shadow:0 0 0 1px #e6dcc4"></div>
<p style="margin:0 0 6px;text-align:center;font-size:14px;color:#5b5341">${h.name} · ${h.event}<br>Registration ${h.code}</p>
<p style="margin:0 0 18px;text-align:center;font-size:11px;color:#8a8170;font-family:'Courier New',monospace;word-break:break-all">Ticket code: ${input.ticketCode}</p>
<p style="margin:0 0 10px;font-size:14px;line-height:1.5"><strong>At the entrance:</strong> show this QR. The organizers scan it, check your name and give you your band.</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.5">The QR admits only you and works once. ${escapeHtml(others)} Please don't share it.</p>
<p style="margin:0;text-align:center"><a href="${eventUrl}" style="display:inline-block;background:#d9a93f;color:#0b0a08;text-decoration:none;font-weight:bold;padding:10px 20px;border-radius:999px">Event details</a></p>
</td></tr></table></body></html>`,
        attachments: [{ filename: "shourya26-ticket.png", content: qrPng, cid: "ticket-qr", contentType: "image/png" }],
    };
}

// Promotes approved registrations whose members all have their ticket email to TICKET_ISSUED.
async function promoteTicketedRegistrations() {
    const ready = await prisma.registration.findMany({
        where: { status: "APPROVED", participants: { every: { ticketEmailedAt: { not: null } } } },
        select: { id: true, participants: { select: { name: true } } },
    });
    for (const reg of ready) {
        await prisma.$transaction(async (tx) => {
            const changed = await tx.registration.updateMany({
                where: { id: reg.id, status: "APPROVED" },
                data: { status: "TICKET_ISSUED" },
            });
            if (changed.count !== 1) return;
            await addAudit(tx, {
                registrationId: reg.id,
                action: "TICKETS_EMAILED",
                fromStatus: "APPROVED",
                toStatus: "TICKET_ISSUED",
                detail: `Entry QR emailed to ${reg.participants.map((p) => p.name).join(", ")}`,
            });
            await queueRegistrationSync(tx, reg.id);
        });
    }
    return ready.length;
}

type SendResult = { sent: number; failed: { email: string; error: string }[]; ticketsIssued: number };

// Emails the entry QR to members of approved registrations who haven't received it yet.
// `send` is injectable so tests never reach a real mail server.
export async function sendPendingTicketEmails({ limit = 100, send = smtpSendMail }: { limit?: number; send?: SendMail } = {}) {
    const result: SendResult = { sent: 0, failed: [], ticketsIssued: 0 };
    const stale = () => new Date(Date.now() - CLAIM_TIMEOUT_MS);
    const pending = await prisma.participant.findMany({
        where: {
            ticketEmailedAt: null,
            registration: { status: { in: TICKETED } },
            OR: [{ ticketEmailAttemptAt: null }, { ticketEmailAttemptAt: { lt: stale() } }],
        },
        include: { registration: { include: { event: true } } },
        orderBy: { createdAt: "asc" },
        take: limit,
    });
    const touched = new Set<string>();

    for (const member of pending) {
        const claimed = await prisma.participant.updateMany({
            where: {
                id: member.id,
                ticketEmailedAt: null,
                OR: [{ ticketEmailAttemptAt: null }, { ticketEmailAttemptAt: { lt: stale() } }],
            },
            data: { ticketEmailAttemptAt: new Date() },
        });
        if (claimed.count !== 1) continue;
        const reg = member.registration;
        let sendError: string | null = null;
        try {
            const message = ticketEmail(
                {
                    name: member.name,
                    teamName: reg.teamName,
                    code: reg.code,
                    eventName: reg.event.name,
                    eventSlug: reg.event.slug,
                    teamSize: reg.teamSize,
                    ticketCode: member.ticketCode,
                },
                await ticketQrPng(member.ticketCode),
            );
            await send({ to: member.email, ...message });
        } catch (error) {
            sendError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        }
        // Record the outcome on the member and their own row in the Participants sheet.
        await prisma.$transaction(async (tx) => {
            await tx.participant.update({
                where: { id: member.id },
                data: sendError ? { ticketEmailError: sendError } : { ticketEmailedAt: new Date(), ticketEmailError: null },
            });
            await queueParticipantSync(tx, member.id);
        });
        if (sendError) result.failed.push({ email: member.email, error: sendError });
        else result.sent++;
        touched.add(reg.id);
    }

    result.ticketsIssued = await promoteTicketedRegistrations();
    // Registrations that are still partly sent (or failed) get their Sheets email status refreshed.
    for (const id of touched) {
        await prisma.$transaction(async (tx) => {
            await queueRegistrationSync(tx, id);
        });
    }
    return result;
}

let runNow: (() => Promise<void>) | undefined;

// Sends ticket emails on an interval once SMTP is configured. Returns a stop function.
export function startTicketMailer() {
    if (!mailConfigured()) {
        console.warn("Email isn't configured (SMTP_HOST, SMTP_USER, SMTP_PASS): ticket emails are off.");
        return () => {};
    }
    const interval = Math.max(15_000, Number(process.env.TICKET_EMAIL_INTERVAL_MS) || 60_000);
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await sendPendingTicketEmails();
            if (result.sent) console.info(`Tickets: emailed ${result.sent} entry QR code(s)`);
            for (const failure of result.failed) console.error(`Tickets: email to ${failure.email} failed: ${failure.error}`);
        } catch (error) {
            console.error("Ticket emails failed:", error instanceof Error ? error.message : error);
        } finally {
            running = false;
        }
    };
    runNow = tick;
    const timer = setInterval(() => void tick(), interval);
    void tick();
    console.info(`Ticket emails on (every ${Math.round(interval / 1000)}s)`);
    return () => {
        clearInterval(timer);
        runNow = undefined;
    };
}

// Lets an approval send its tickets right away instead of waiting for the next tick.
export function sendTicketsSoon() {
    const tick = runNow;
    if (tick) setTimeout(() => void tick(), 500);
}

export async function ticketMailStatus() {
    const [pending, failed] = await Promise.all([
        prisma.participant.count({ where: { ticketEmailedAt: null, registration: { status: { in: TICKETED } } } }),
        prisma.participant.count({
            where: { ticketEmailedAt: null, ticketEmailError: { not: null }, registration: { status: { in: TICKETED } } },
        }),
    ]);
    return { configured: mailConfigured(), pending, failed };
}

// Queues the ticket email again for one member or the whole team (same QR codes).
export async function resendTickets(registrationId: string, adminId: string, participantId?: unknown) {
    if (!mailConfigured()) throw httpError(409, "Email isn't configured yet, so tickets can't be sent");
    return prisma.$transaction(async (tx) => {
        const reg = await tx.registration.findUnique({ where: { id: registrationId }, include: { participants: true } });
        if (!reg) throw httpError(404, "Registration not found");
        if (!TICKETED.includes(reg.status)) throw httpError(409, "Tickets are sent only for approved registrations");
        const members =
            typeof participantId === "string" ? reg.participants.filter((p) => p.id === participantId) : reg.participants;
        if (members.length === 0) throw httpError(404, "Team member not found");
        await tx.participant.updateMany({
            where: { id: { in: members.map((p) => p.id) } },
            data: { ticketEmailedAt: null, ticketEmailAttemptAt: null, ticketEmailError: null },
        });
        for (const member of members) await queueParticipantSync(tx, member.id);
        await addAudit(tx, {
            registrationId,
            actorId: adminId,
            action: "TICKETS_RESENT",
            detail: `Entry QR email queued again for ${members.map((p) => p.name).join(", ")}`,
        });
        return queueRegistrationSync(tx, registrationId);
    });
}

const ticketInclude = {
    checkedInBy: { select: { name: true } },
    registration: {
        include: {
            event: { select: { name: true, slug: true } },
            participants: { select: { id: true, name: true, checkedInAt: true }, orderBy: { createdAt: "asc" } },
        },
    },
} as const satisfies Prisma.ParticipantInclude;

type TicketRecord = Prisma.ParticipantGetPayload<{ include: typeof ticketInclude }>;

function ticketView(p: TicketRecord) {
    const reg = p.registration;
    const approved = TICKETED.includes(reg.status) && reg.verified;
    return {
        admission: !approved ? "NOT_APPROVED" : p.checkedInAt ? "ALREADY_ENTERED" : "ALLOWED",
        participant: {
            id: p.id,
            name: p.name,
            email: p.email,
            college: p.college,
            rollNumber: p.rollNumber,
            checkedInAt: p.checkedInAt,
            checkedInBy: p.checkedInBy?.name ?? null,
        },
        registration: {
            id: reg.id,
            code: reg.code,
            teamName: reg.teamName,
            teamSize: reg.teamSize,
            college: reg.college,
            status: reg.status,
        },
        event: reg.event,
        teammates: reg.participants,
    };
}

// Looks up a scanned QR. Unknown codes are a 404 so a fake QR is obvious at the gate.
// With `admitBy` (the scanning organizer), a valid unused ticket is checked in straight away, so
// the first scan uses it up and every later scan shows ALREADY_ENTERED. `scanId` identifies one
// physical scan: a network retry of that scan returns its original "admitted" result.
export async function scanTicket(raw: unknown, admitBy?: string, scanId?: string) {
    const code = parseTicketCode(raw);
    if (!code) throw httpError(400, "This isn't a SHOURYA'26 ticket QR");
    const member = await prisma.participant.findUnique({ where: { ticketCode: code }, include: ticketInclude });
    if (!member) throw httpError(404, "Ticket not found: this QR isn't a valid SHOURYA'26 ticket");
    const view = ticketView(member);
    if (admitBy && scanId && member.checkedInAt && member.checkInScanId === scanId)
        return { ...view, justAdmitted: true };
    if (!admitBy || view.admission !== "ALLOWED") return { ...view, justAdmitted: false };
    try {
        return { ...(await admitParticipant(member.id, admitBy, scanId)), justAdmitted: true };
    } catch (error) {
        // Two volunteers scanned the same QR at once: the other scan won, so show it as used.
        if ((error as { status?: number }).status !== 409) throw error;
        const latest = await prisma.participant.findUniqueOrThrow({ where: { id: member.id }, include: ticketInclude });
        return { ...ticketView(latest), justAdmitted: false };
    }
}

// Marks one member as entered. Works once per member; the team counts as entered with its first member.
// The conditional update (checkedInAt still null) makes simultaneous attempts admit exactly once.
export async function admitParticipant(participantId: string, adminId: string, scanId?: string) {
    await prisma.$transaction(async (tx) => {
        const member = await tx.participant.findUnique({ where: { id: participantId }, include: { registration: true } });
        if (!member) throw httpError(404, "Ticket not found");
        const reg = member.registration;
        if (!TICKETED.includes(reg.status) || !reg.verified)
            throw httpError(409, "This registration isn't approved, so this person can't enter");
        const now = new Date();
        const changed = await tx.participant.updateMany({
            where: { id: participantId, checkedInAt: null },
            data: { checkedInAt: now, checkedInById: adminId, checkInScanId: scanId ?? null },
        });
        if (changed.count !== 1) throw httpError(409, `${member.name} has already entered`);
        await tx.registration.updateMany({
            where: { id: reg.id, entered: false },
            data: { entered: true, enteredAt: now, enteredById: adminId, entryAllowed: true },
        });
        await addAudit(tx, {
            registrationId: reg.id,
            actorId: adminId,
            action: "MEMBER_CHECKED_IN",
            detail: `${member.name} entered (ticket scanned)`,
        });
        await queueParticipantSync(tx, participantId);
        await queueRegistrationSync(tx, reg.id);
    });
    const member = await prisma.participant.findUniqueOrThrow({ where: { id: participantId }, include: ticketInclude });
    return ticketView(member);
}

// The member's QR as a PNG for the team's dashboard (owner) or organizers, once approved.
export async function ticketImage(registrationId: string, participantId: string, userId: string, isAdmin: boolean) {
    const member = await prisma.participant.findFirst({
        where: { id: participantId, registrationId },
        include: { registration: { select: { userId: true, status: true } } },
    });
    if (!member) throw httpError(404, "Ticket not found");
    if (!isAdmin && member.registration.userId !== userId) throw httpError(403, "You cannot access this ticket");
    if (!TICKETED.includes(member.registration.status))
        throw httpError(409, "Tickets are issued after the organizers approve the registration");
    return ticketQrPng(member.ticketCode);
}
