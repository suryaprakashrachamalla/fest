import { prisma } from "./lib/prisma.ts";
import { addAudit, queueRegistrationSync } from "./lib/registrationSync.ts";

// Adds every member of an organizer-approved registration to the matching Luma event.
// Luma then sends its own confirmation and ticket email, so nothing is sent before approval.
// API reference: https://docs.luma.com/reference/post_v1-events-guests-add (needs Luma Plus).

const API_URL = (process.env.LUMA_API_URL?.trim() || "https://public-api.luma.com").replace(/\/$/, "");
// A claimed registration is retried if the previous attempt hasn't finished within this window.
const CLAIM_TIMEOUT_MS = 5 * 60_000;

// Parses "slug=value,slug=value" settings such as LUMA_EVENT_IDS and LUMA_TICKET_TYPE_IDS.
function slugMap(setting: string | undefined) {
    const map = new Map<string, string>();
    for (const pair of (setting ?? "").split(",")) {
        const [slug, value] = pair.split("=").map((part) => part?.trim());
        // Placeholders from .env.example (evt-REPLACE) count as not mapped yet.
        if (slug && value && !/REPLACE/i.test(value)) map.set(slug, value);
    }
    return map;
}

// LUMA_EVENT_IDS maps website event slugs to Luma event IDs, e.g. "hackathon=evt-abc,build-lab=evt-def".
export function lumaEventIds() {
    return slugMap(process.env.LUMA_EVENT_IDS);
}

// Optional LUMA_TICKET_TYPE_IDS picks the Luma ticket type each event's guests get (for example a free
// "Paid on website" ticket), so nobody is asked to pay again in Luma. Without it Luma uses its default.
export function lumaTicketTypeIds() {
    return slugMap(process.env.LUMA_TICKET_TYPE_IDS);
}

export function lumaConfigured() {
    return Boolean(process.env.LUMA_API_KEY?.trim()) && lumaEventIds().size > 0;
}

type SyncResult = {
    code: string;
    event: string;
    lumaEventId: string | null;
    guests: string[];
    outcome: "added" | "would-add" | "no-luma-event" | "failed" | "skipped-busy";
    detail?: string;
};

function lumaHeaders() {
    return { "Content-Type": "application/json", "x-luma-api-key": process.env.LUMA_API_KEY!.trim() };
}

// Luma emails each added guest their ticket with the check-in QR code that is scanned at the entrance.
async function addGuests(lumaEventId: string, guests: { email: string; name: string }[], ticketTypeId?: string) {
    const response = await fetch(`${API_URL}/v1/events/guests/add`, {
        method: "POST",
        headers: lumaHeaders(),
        body: JSON.stringify({
            event_id: lumaEventId,
            guests,
            approval_status: "approved",
            send_email: true,
            ...(ticketTypeId ? { ticket: { event_ticket_type_id: ticketTypeId } } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Luma responded ${response.status}: ${text.slice(0, 400)}`);
    const body = text ? (JSON.parse(text) as { skipped?: { email: string }[] }) : {};
    return (body.skipped ?? []).map((guest) => guest.email);
}

// Processes approved registrations that aren't in Luma yet. With dryRun, only reports what would be sent.
export async function syncApprovedToLuma({ dryRun = false, limit = 50 } = {}) {
    const eventIds = lumaEventIds();
    const ticketTypes = lumaTicketTypeIds();
    if (!dryRun && !process.env.LUMA_API_KEY?.trim()) throw new Error("LUMA_API_KEY is not set");
    const pending = await prisma.registration.findMany({
        where: { status: "APPROVED", lumaSyncedAt: null },
        include: { event: true, participants: { orderBy: { createdAt: "asc" } } },
        orderBy: { approvedAt: "asc" },
        take: limit,
    });
    const results: SyncResult[] = [];

    for (const reg of pending) {
        const lumaEventId = eventIds.get(reg.event.slug) ?? null;
        const guests = reg.participants.map((p) => ({ email: p.email, name: p.name }));
        const base = { code: reg.code, event: reg.event.slug, lumaEventId, guests: guests.map((g) => g.email) };
        if (!lumaEventId) {
            results.push({ ...base, outcome: "no-luma-event", detail: `Add ${reg.event.slug}=evt-… to LUMA_EVENT_IDS` });
            continue;
        }
        if (dryRun) {
            results.push({ ...base, outcome: "would-add" });
            continue;
        }

        const now = new Date();
        const claimed = await prisma.registration.updateMany({
            where: {
                id: reg.id,
                status: "APPROVED",
                lumaSyncedAt: null,
                OR: [{ lumaAttemptAt: null }, { lumaAttemptAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } }],
            },
            data: { lumaAttemptAt: now },
        });
        if (claimed.count !== 1) {
            results.push({ ...base, outcome: "skipped-busy" });
            continue;
        }

        try {
            const skipped = await addGuests(lumaEventId, guests, ticketTypes.get(reg.event.slug));
            const skippedNote = skipped.length ? `Luma skipped (unsubscribed or blocked): ${skipped.join(", ")}` : null;
            await prisma.$transaction(async (tx) => {
                const changed = await tx.registration.updateMany({
                    where: { id: reg.id, status: "APPROVED" },
                    data: { status: "TICKET_ISSUED", lumaSyncedAt: new Date(), lumaError: skippedNote },
                });
                // A registration rejected while the request was in flight keeps its new status.
                if (changed.count !== 1) {
                    await tx.registration.update({ where: { id: reg.id }, data: { lumaSyncedAt: new Date() } });
                }
                await addAudit(tx, {
                    registrationId: reg.id,
                    action: "LUMA_GUESTS_ADDED",
                    fromStatus: changed.count === 1 ? "APPROVED" : null,
                    toStatus: changed.count === 1 ? "TICKET_ISSUED" : null,
                    detail: [`Added ${guests.length - skipped.length} guest(s) to Luma event ${lumaEventId}; Luma emails their tickets`, skippedNote]
                        .filter(Boolean)
                        .join(". "),
                });
                await queueRegistrationSync(tx, reg.id);
            });
            results.push({ ...base, outcome: "added", detail: skippedNote ?? undefined });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await prisma.$transaction(async (tx) => {
                await tx.registration.update({ where: { id: reg.id }, data: { lumaError: message.slice(0, 500) } });
                await queueRegistrationSync(tx, reg.id);
            });
            results.push({ ...base, outcome: "failed", detail: message });
        }
    }
    return results;
}

// Runs the sync on an interval when LUMA_AUTO_SYNC=true. Returns a stop function.
export function startLumaWorker() {
    if (process.env.LUMA_AUTO_SYNC?.trim() !== "true") return () => {};
    if (!lumaConfigured()) {
        console.warn("LUMA_AUTO_SYNC is on but LUMA_API_KEY or LUMA_EVENT_IDS is missing; Luma sync is off.");
        return () => {};
    }
    const interval = Math.max(15_000, Number(process.env.LUMA_SYNC_INTERVAL_MS) || 60_000);
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            for (const result of await syncApprovedToLuma()) {
                if (result.outcome === "added") console.info(`Luma: added ${result.code} (${result.guests.length} guest(s))`);
                if (result.outcome === "failed") console.error(`Luma: ${result.code} failed: ${result.detail}`);
            }
            for (const summary of await importLumaCheckIns()) {
                if (summary.teamsEntered) console.info(`Luma: ${summary.teamsEntered} team(s) checked in at ${summary.event}`);
                if (summary.error) console.error(`Luma check-ins for ${summary.event} failed: ${summary.error}`);
            }
        } catch (error) {
            console.error("Luma sync failed:", error instanceof Error ? error.message : error);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(() => void tick(), interval);
    void tick();
    console.info(`Luma auto sync on (every ${Math.round(interval / 1000)}s)`);
    return () => clearInterval(timer);
}

// Lets an approval trigger the sync right away instead of waiting for the next tick.
export function syncSoon() {
    if (process.env.LUMA_AUTO_SYNC?.trim() !== "true" || !lumaConfigured()) return;
    setTimeout(() => {
        syncApprovedToLuma().catch((error) =>
            console.error("Luma sync failed:", error instanceof Error ? error.message : error),
        );
    }, 500);
}

type LumaGuest = { id: string; user_email: string; event_tickets?: { checked_in_at: string | null }[] };

async function listLumaGuests(lumaEventId: string) {
    const guests: LumaGuest[] = [];
    let cursor: string | undefined;
    do {
        const query = new URLSearchParams({ event_id: lumaEventId, pagination_limit: "100" });
        if (cursor) query.set("pagination_cursor", cursor);
        const response = await fetch(`${API_URL}/v1/events/guests/list?${query}`, {
            headers: lumaHeaders(),
            signal: AbortSignal.timeout(20_000),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`Luma responded ${response.status}: ${text.slice(0, 400)}`);
        const page = JSON.parse(text) as { entries: LumaGuest[]; has_more: boolean; next_cursor?: string };
        guests.push(...page.entries);
        cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return guests;
}

// Earliest scan across the guest's tickets, or null if they haven't been checked in.
function firstCheckIn(guest: LumaGuest) {
    const times = (guest.event_tickets ?? [])
        .map((ticket) => ticket.checked_in_at)
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value).getTime());
    return times.length ? new Date(Math.min(...times)) : null;
}

// Pulls each member's Luma guest ID and entrance scans (made in the Luma check-in app) into the database.
// A team counts as entered as soon as one of its members is scanned; the Sheets row follows.
export async function importLumaCheckIns() {
    const summaries: {
        event: string;
        lumaGuests: number;
        guestIdsSaved: number;
        membersScanned: number;
        teamsEntered: number;
        error?: string;
    }[] = [];
    for (const [slug, lumaEventId] of lumaEventIds()) {
        const summary = { event: slug, lumaGuests: 0, guestIdsSaved: 0, membersScanned: 0, teamsEntered: 0 };
        try {
            const guests = await listLumaGuests(lumaEventId);
            const byEmail = new Map(guests.map((g) => [g.user_email.trim().toLowerCase(), g]));
            summary.lumaGuests = byEmail.size;
            const registrations = await prisma.registration.findMany({
                where: { event: { slug }, lumaSyncedAt: { not: null } },
                include: { participants: true },
            });
            for (const reg of registrations) {
                let changed = false;
                const members = [];
                for (const p of reg.participants) {
                    const guest = byEmail.get(p.email.toLowerCase());
                    const scannedAt = guest ? firstCheckIn(guest) : null;
                    if (scannedAt) summary.membersScanned++;
                    const newId = guest && p.lumaGuestId !== guest.id;
                    const newScan = scannedAt && p.lumaCheckedInAt?.getTime() !== scannedAt.getTime();
                    if (guest && (newId || newScan)) {
                        if (newId) summary.guestIdsSaved++;
                        await prisma.participant.update({
                            where: { id: p.id },
                            data: { lumaGuestId: guest.id, ...(scannedAt ? { lumaCheckedInAt: scannedAt } : {}) },
                        });
                        changed = true;
                    }
                    members.push({ name: p.name, scannedAt: scannedAt ?? p.lumaCheckedInAt });
                }
                const scanned = members.filter((m): m is { name: string; scannedAt: Date } => Boolean(m.scannedAt));
                await prisma.$transaction(async (tx) => {
                    if (scanned.length && !reg.entered && reg.status === "TICKET_ISSUED") {
                        const enteredAt = new Date(Math.min(...scanned.map((m) => m.scannedAt.getTime())));
                        const result = await tx.registration.updateMany({
                            where: { id: reg.id, entered: false },
                            data: { entered: true, enteredAt, entryAllowed: true },
                        });
                        if (result.count === 1) {
                            summary.teamsEntered++;
                            await addAudit(tx, {
                                registrationId: reg.id,
                                action: "CHECKED_IN",
                                detail: `Scanned in the Luma check-in app: ${scanned.map((m) => m.name).join(", ")}`,
                            });
                            changed = true;
                        }
                    }
                    if (changed) await queueRegistrationSync(tx, reg.id);
                });
            }
        } catch (error) {
            summaries.push({ ...summary, error: error instanceof Error ? error.message : String(error) });
            continue;
        }
        summaries.push(summary);
    }
    return summaries;
}
