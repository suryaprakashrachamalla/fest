import { prisma } from "./lib/prisma.ts";
import { addAudit, queueRegistrationSync } from "./lib/registrationSync.ts";

// Adds every member of an organizer-approved registration to the matching Luma event.
// Luma then sends its own confirmation and ticket email, so nothing is sent before approval.
// API reference: https://docs.luma.com/reference/post_v1-events-guests-add (needs Luma Plus).

const API_URL = (process.env.LUMA_API_URL?.trim() || "https://public-api.luma.com").replace(/\/$/, "");
// A claimed registration is retried if the previous attempt hasn't finished within this window.
const CLAIM_TIMEOUT_MS = 5 * 60_000;

// LUMA_EVENT_IDS maps website event slugs to Luma event IDs, e.g. "hackathon=evt-abc,build-lab=evt-def".
export function lumaEventIds() {
    const map = new Map<string, string>();
    for (const pair of (process.env.LUMA_EVENT_IDS ?? "").split(",")) {
        const [slug, eventId] = pair.split("=").map((part) => part?.trim());
        // Placeholders from .env.example (evt-REPLACE) count as not mapped yet.
        if (slug && eventId && !/REPLACE/i.test(eventId)) map.set(slug, eventId);
    }
    return map;
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

async function addGuests(lumaEventId: string, guests: { email: string; name: string }[]) {
    const response = await fetch(`${API_URL}/v1/events/guests/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-luma-api-key": process.env.LUMA_API_KEY!.trim() },
        body: JSON.stringify({ event_id: lumaEventId, guests, approval_status: "approved", send_email: true }),
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
            const skipped = await addGuests(lumaEventId, guests);
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
