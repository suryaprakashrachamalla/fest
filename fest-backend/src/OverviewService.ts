import type { NextFunction, Request, Response } from "express";
import { prisma } from "./lib/prisma.ts";
import { readEventTabs } from "./ExcelSyncService.ts";
import { parseRegistrationCode } from "./TicketService.ts";
import { uniqueViolation } from "./lib/prismaErrors.ts";
import {
    addTotals,
    classify,
    emptyTotals,
    filterRecords,
    readEventTab,
    toCsv,
    totalsOf,
    type Classified,
    type ExclusionIndex,
    type RecordFilter,
    type TabQuality,
} from "./lib/analytics.ts";

// Super admins are the accounts configured as ADMIN_SUPER_EMAIL, ADMIN_SUPER2_EMAIL, ...
export function superAdminEmails(env: NodeJS.ProcessEnv = process.env) {
    return new Set(
        Object.entries(env)
            .filter(([key, value]) => /^ADMIN_SUPER\d*_EMAIL$/.test(key) && value?.trim())
            .map(([, value]) => value!.trim().toLowerCase()),
    );
}

// Event analytics viewers: normal accounts given read-only analytics for some events. Runs after
// authenticate; puts the viewer's event IDs on res.locals, or refuses anyone without any.
export async function requireEventViewer(req: Request, res: Response, next: NextFunction) {
    const grants = req.user ? await prisma.eventAnalyticsAccess.findMany({ where: { userId: req.user.id }, select: { eventId: true } }) : [];
    if (grants.length === 0) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You don't have access to event analytics" } });
        return;
    }
    res.locals.eventIds = grants.map((grant) => grant.eventId);
    next();
}

// Runs after authenticate + requireAdmin: lets only super admins through.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.user || !superAdminEmails().has(req.user.email.toLowerCase())) {
        res.status(403).json({
            success: false,
            error: { code: "FORBIDDEN", message: "Super admin access required" },
        });
        return;
    }
    next();
}

// `expose` lets the error handler show a 5xx message that was written for organizers.
function httpError(status: number, message: string) {
    return Object.assign(new Error(message), { status, expose: status >= 500 });
}

// ---- Reading the sheet ------------------------------------------------------------------------
// The analytics are read from each event's tab in the Google Sheet (the database is only used to
// cross-check and to apply the exclusion rules). A read is reused for a short while so refreshing
// the dashboard doesn't spend Google API quota, and if Google fails the last read is shown,
// marked stale, rather than nothing.

const cacheMs = () => Math.max(0, Number(process.env.ANALYTICS_CACHE_MS ?? 30_000));
// "Refresh" reads the sheet again, but not more than once every few seconds.
const MIN_REFRESH_MS = 5_000;
// After this, an old read is no longer shown when Google fails.
const STALE_LIMIT_MS = 15 * 60_000;

type SheetTab = { eventId: string; event: string; title: string; found: boolean; rows: unknown[][] };
type Snapshot = { readAt: Date; tabs: SheetTab[] };

let cache: Snapshot | null = null;
let reading: Promise<Snapshot> | null = null;

export function clearAnalyticsCache() {
    cache = null;
}

async function readSheet(events: { id: string; name: string }[]): Promise<Snapshot> {
    const tabs = await readEventTabs(events.map((event) => event.name));
    return {
        readAt: new Date(),
        tabs: events.map((event, i) => ({
            eventId: event.id,
            event: event.name,
            title: tabs[i].tab,
            found: tabs[i].rows !== null,
            rows: tabs[i].rows ?? [],
        })),
    };
}

async function snapshot(refresh: boolean): Promise<{ snap: Snapshot; stale: boolean; staleReason: string | null }> {
    const events = await prisma.event.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    const sameEvents =
        cache !== null &&
        cache.tabs.length === events.length &&
        cache.tabs.every((tab, i) => tab.eventId === events[i].id && tab.event === events[i].name);
    const age = cache ? Date.now() - cache.readAt.getTime() : Infinity;
    if (cache && sameEvents && age < (refresh ? MIN_REFRESH_MS : cacheMs())) return { snap: cache, stale: false, staleReason: null };
    try {
        // Dashboards opened at the same moment share one read.
        reading ??= readSheet(events).finally(() => {
            reading = null;
        });
        cache = await reading;
        return { snap: cache, stale: false, staleReason: null };
    } catch (error) {
        console.error("Analytics: reading the Google Sheet failed:", error instanceof Error ? error.message : error);
        // Sheets isn't configured at all. (Google's own errors carry HTTP statuses too, so this is a flag.)
        if ((error as { notConfigured?: boolean }).notConfigured) throw error;
        if (cache && sameEvents && age < STALE_LIMIT_MS)
            return {
                snap: cache,
                stale: true,
                staleReason: "Google Sheets didn't answer just now, so these numbers are from the last successful read.",
            };
        throw httpError(503, "Couldn't read the Google Sheet right now. Try again in a minute.");
    }
}

// ---- Test-data exclusions ----------------------------------------------------------------------

// Registration ID -> why it's test data, from the super admins' exclusion rules: single
// registrations, and every registration made by an excluded account.
export async function exclusionIndex(): Promise<ExclusionIndex> {
    const rules = await prisma.analyticsExclusion.findMany({ orderBy: { createdAt: "asc" } });
    const index: ExclusionIndex = new Map();
    for (const rule of rules)
        if (rule.kind === "REGISTRATION") index.set(rule.value, `Test registration: ${rule.reason}`);
    const accounts = new Map(rules.filter((rule) => rule.kind === "ACCOUNT").map((rule) => [rule.value, rule.reason]));
    if (accounts.size) {
        const registrations = await prisma.registration.findMany({
            where: { user: { email: { in: [...accounts.keys()] } } },
            select: { code: true, user: { select: { email: true } } },
        });
        for (const reg of registrations)
            if (!index.has(reg.code)) index.set(reg.code, `Test account ${reg.user.email}: ${accounts.get(reg.user.email)}`);
    }
    return index;
}

async function classifiedRecords(refresh: boolean) {
    const [{ snap, stale, staleReason }, excluded] = await Promise.all([snapshot(refresh), exclusionIndex()]);
    const tabs = snap.tabs.map((tab) => {
        const { records, quality } = readEventTab({ eventId: tab.eventId, event: tab.event, title: tab.title }, tab.rows);
        return { tab, records: classify(records, excluded), quality };
    });
    return { snap, stale, staleReason, excluded, tabs };
}

// ---- Overview ----------------------------------------------------------------------------------

// Per event: production numbers (test data left out) and the excluded test data on its own, plus
// what was skipped while reading the tab. The database's approved count (with the same exclusions)
// is shown alongside as a cross-check.
// With `eventIds` (an event analytics viewer), only those events are included: their rows,
// their totals and their sheet checks; nothing about other events or the exclusion rules.
export async function eventOverview(options: { refresh?: boolean; eventIds?: string[] } = {}) {
    const data = await classifiedRecords(options.refresh === true);
    const { snap, stale, staleReason, excluded } = data;
    const tabs = options.eventIds ? data.tabs.filter(({ tab }) => options.eventIds!.includes(tab.eventId)) : data.tabs;
    const approvedInDatabase = await prisma.registration.findMany({
        where: { status: { in: ["APPROVED", "TICKET_ISSUED"] } },
        select: { code: true, eventId: true },
    });
    const events = tabs.map(({ tab, records, quality }) => {
        const production = totalsOf(records.filter((r) => !r.excluded));
        const excludedTotals = totalsOf(records.filter((r) => r.excluded));
        const databaseApprovedTeams = approvedInDatabase.filter(
            (reg) => reg.eventId === tab.eventId && !excluded.has(reg.code),
        ).length;
        return {
            eventId: tab.eventId,
            name: tab.event,
            tab: tab.title,
            tabFound: tab.found,
            production,
            excluded: excludedTotals,
            quality,
            // The production numbers under the original field names, for older dashboards.
            approvedTeams: production.approvedTeams,
            approvedParticipants: production.approvedParticipants,
            approvedAmountPaise: production.approvedAmountPaise,
            totalRows: production.registrations,
            databaseApprovedTeams,
            matchesDatabase: production.approvedTeams === databaseApprovedTeams,
        };
    });
    const production = events.reduce((sum, row) => addTotals(sum, row.production), emptyTotals());
    const excludedTotals = events.reduce((sum, row) => addTotals(sum, row.excluded), emptyTotals());
    const quality = (key: keyof Pick<TabQuality, "rowsWithoutId" | "rowsWithProblems">) =>
        events.reduce((sum, row) => sum + row.quality[key], 0);
    return {
        source: "google-sheets" as const,
        readAt: snap.readAt.toISOString(),
        stale,
        staleReason,
        events,
        totals: {
            approvedTeams: production.approvedTeams,
            approvedParticipants: production.approvedParticipants,
            approvedAmountPaise: production.approvedAmountPaise,
            production,
            excluded: excludedTotals,
        },
        allMatchDatabase: events.every((row) => row.matchesDatabase),
        exclusionRules: options.eventIds ? 0 : await prisma.analyticsExclusion.count(),
        dataQuality: {
            rowsWithoutId: quality("rowsWithoutId"),
            rowsWithProblems: quality("rowsWithProblems"),
            duplicateIds: events.flatMap((row) => row.quality.duplicateIds),
            tabsMissingColumns: events
                .filter((row) => row.tabFound && row.quality.missingColumns.length)
                .map((row) => ({ tab: row.tab, missingColumns: row.quality.missingColumns })),
        },
    };
}

// ---- Records (the rows behind the numbers) ----------------------------------------------------

const token = (value: unknown, max = 30) =>
    typeof value === "string" && value.trim() && /^[A-Za-z_]+$/.test(value.trim()) && value.trim().length <= max
        ? value.trim().toUpperCase()
        : undefined;
const isoDate = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(value) && !Number.isNaN(Date.parse(value))
        ? value
        : undefined;

export function parseRecordQuery(query: Record<string, unknown>) {
    const scope = query.scope === "excluded" || query.scope === "all" ? query.scope : "production";
    const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : undefined;
    const eventId = typeof query.event === "string" && /^[0-9a-f-]{36}$/i.test(query.event) ? query.event : undefined;
    const filter: RecordFilter = {
        q: q || undefined,
        eventId,
        payment: token(query.payment),
        approval: token(query.approval),
        scope,
        from: isoDate(query.from),
        to: isoDate(query.to),
    };
    const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? "1"), 10) || 1));
    const pageSize = Math.max(1, Math.min(200, Number.parseInt(String(query.pageSize ?? "50"), 10) || 50));
    return { filter, page, pageSize, refresh: query.refresh === "true" };
}

// With `eventIds` (an event analytics viewer), only those events' production records are searched;
// asking for another event is refused rather than silently answered.
async function filteredRecords(query: Record<string, unknown>, eventIds?: string[]) {
    const parsed = parseRecordQuery(query);
    if (eventIds) {
        if (parsed.filter.eventId && !eventIds.includes(parsed.filter.eventId)) throw httpError(403, "You can only see your own events");
        parsed.filter.scope = "production";
    }
    const data = await classifiedRecords(parsed.refresh);
    const all: Classified[] = data.tabs
        .filter(({ tab }) => !eventIds || eventIds.includes(tab.eventId))
        .flatMap((tab) => tab.records);
    const matching = filterRecords(all, parsed.filter).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
    return { ...parsed, ...data, matching };
}

export async function analyticsRecords(query: Record<string, unknown>, eventIds?: string[]) {
    const { snap, stale, staleReason, matching, page, pageSize, filter } = await filteredRecords(query, eventIds);
    return {
        readAt: snap.readAt.toISOString(),
        stale,
        staleReason,
        filter,
        total: matching.length,
        page,
        pageSize,
        records: matching.slice((page - 1) * pageSize, page * pageSize),
    };
}

export async function analyticsCsv(query: Record<string, unknown>, eventIds?: string[]) {
    const { matching } = await filteredRecords(query, eventIds);
    return toCsv(matching.slice(0, 20_000));
}

// ---- Managing the exclusion rules --------------------------------------------------------------

export async function listExclusions() {
    const rules = await prisma.analyticsExclusion.findMany({
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
    });
    const accountEmails = rules.filter((rule) => rule.kind === "ACCOUNT").map((rule) => rule.value);
    const perAccount = accountEmails.length
        ? await prisma.registration.groupBy({
              by: ["userId"],
              where: { user: { email: { in: accountEmails } } },
              _count: { _all: true },
          })
        : [];
    const users = accountEmails.length
        ? await prisma.user.findMany({ where: { email: { in: accountEmails } }, select: { id: true, email: true } })
        : [];
    const countByEmail = new Map(
        users.map((user) => [user.email, perAccount.find((group) => group.userId === user.id)?._count._all ?? 0]),
    );
    return rules.map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        value: rule.value,
        reason: rule.reason,
        createdBy: rule.createdBy?.name ?? null,
        createdAt: rule.createdAt,
        registrations: rule.kind === "REGISTRATION" ? 1 : (countByEmail.get(rule.value) ?? 0),
    }));
}

export async function addExclusion(adminId: string, body: { kind?: unknown; value?: unknown; reason?: unknown }) {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 200) throw httpError(400, "Give a reason between 3 and 200 characters");
    let kind: "REGISTRATION" | "ACCOUNT";
    let value: string;
    if (body.kind === "REGISTRATION") {
        const code = parseRegistrationCode(body.value);
        if (!code) throw httpError(400, "Enter a registration ID like SG26-3H8945J2");
        if (!(await prisma.registration.findUnique({ where: { code }, select: { id: true } })))
            throw httpError(404, "No registration has this ID");
        kind = "REGISTRATION";
        value = code;
    } else if (body.kind === "ACCOUNT") {
        const email = typeof body.value === "string" ? body.value.trim().toLowerCase() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw httpError(400, "Enter the account's email address");
        if (!(await prisma.user.findUnique({ where: { email }, select: { id: true } })))
            throw httpError(404, "No account signs in with this email");
        kind = "ACCOUNT";
        value = email;
    } else throw httpError(400, "Choose whether to exclude one registration or a whole account");
    try {
        return await prisma.analyticsExclusion.create({ data: { kind, value, reason, createdById: adminId } });
    } catch (error) {
        if (uniqueViolation(error) !== null) throw httpError(409, "This is already excluded");
        throw error;
    }
}

export async function removeExclusion(id: string) {
    const removed = await prisma.analyticsExclusion.deleteMany({ where: { id } });
    if (removed.count === 0) throw httpError(404, "Exclusion rule not found");
    return { removed: true };
}

// Email domains that are only used for testing or throwaway inboxes. A weak signal on its own, so
// these are only suggested; a super admin decides. Add more with ANALYTICS_TEST_EMAIL_DOMAINS.
const TEST_DOMAINS = ["example.com", "example.org", "example.net", "test.local", "test.com", "yopmail.com", "mailinator.com"];

// Accounts that look like test accounts, for a super admin to review and exclude. Organizer
// accounts that registered for events are the strong signal (the account role is stored).
export async function exclusionSuggestions() {
    const domains = [
        ...TEST_DOMAINS,
        ...(process.env.ANALYTICS_TEST_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
    ];
    const [rules, registrations] = await Promise.all([
        prisma.analyticsExclusion.findMany({ select: { kind: true, value: true } }),
        prisma.registration.findMany({
            select: { code: true, user: { select: { email: true, name: true, role: true } } },
            orderBy: { createdAt: "asc" },
        }),
    ]);
    const excludedAccounts = new Set(rules.filter((r) => r.kind === "ACCOUNT").map((r) => r.value));
    const excludedRegistrations = new Set(rules.filter((r) => r.kind === "REGISTRATION").map((r) => r.value));
    const byAccount = new Map<string, { name: string; codes: string[]; reasons: Set<string>; signal: "strong" | "weak" }>();
    for (const reg of registrations) {
        const email = reg.user.email;
        if (excludedAccounts.has(email) || excludedRegistrations.has(reg.code)) continue;
        const reasons: string[] = [];
        let signal: "strong" | "weak" = "weak";
        if (reg.user.role === "ADMIN") {
            reasons.push("Registered from an organizer account");
            signal = "strong";
        }
        if (domains.includes(email.split("@")[1] ?? "")) reasons.push(`Signs in with a test or throwaway email domain (${email.split("@")[1]})`);
        if (!reasons.length) continue;
        const entry = byAccount.get(email) ?? { name: reg.user.name, codes: [], reasons: new Set<string>(), signal };
        entry.codes.push(reg.code);
        reasons.forEach((reason) => entry.reasons.add(reason));
        if (signal === "strong") entry.signal = "strong";
        byAccount.set(email, entry);
    }
    return [...byAccount.entries()].map(([email, entry]) => ({
        kind: "ACCOUNT" as const,
        value: email,
        name: entry.name,
        registrations: entry.codes,
        reasons: [...entry.reasons],
        signal: entry.signal,
    }));
}
