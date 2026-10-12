import type { NextFunction, Request, Response } from "express";
import { prisma } from "./lib/prisma.ts";
import { readEventTabs } from "./ExcelSyncService.ts";

// Super admins are the accounts configured as ADMIN_SUPER_EMAIL, ADMIN_SUPER2_EMAIL, ...
export function superAdminEmails(env: NodeJS.ProcessEnv = process.env) {
    return new Set(
        Object.entries(env)
            .filter(([key, value]) => /^ADMIN_SUPER\d*_EMAIL$/.test(key) && value?.trim())
            .map(([, value]) => value!.trim().toLowerCase()),
    );
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

export type TabSummary = { approvedTeams: number; approvedParticipants: number; approvedAmountPaise: number; totalRows: number };

// Counts the accepted registrations in one event tab: rows whose approvalStatus is APPROVED (this
// includes teams whose tickets were already issued). Columns are found by their header names.
export function summarizeEventTab(rows: unknown[][]): TabSummary {
    const [header = [], ...data] = rows;
    const col = (name: string) => header.findIndex((cell) => String(cell).trim() === name);
    const [approval, size, fee] = [col("approvalStatus"), col("teamSize"), col("registrationFee")];
    const summary: TabSummary = { approvedTeams: 0, approvedParticipants: 0, approvedAmountPaise: 0, totalRows: 0 };
    for (const row of data) {
        if (!row || row.every((cell) => cell === "" || cell === null || cell === undefined)) continue;
        summary.totalRows++;
        if (approval < 0 || String(row[approval] ?? "").trim().toUpperCase() !== "APPROVED") continue;
        summary.approvedTeams++;
        summary.approvedParticipants += Number(row[size]) || 0;
        summary.approvedAmountPaise += Math.round((Number(String(row[fee] ?? "").replace(/[^0-9.]/g, "")) || 0) * 100);
    }
    return summary;
}

// Super admin overview, read strictly from each event's tab in the Google Sheet: accepted teams,
// participants and fees per event, with the database's approved count alongside as a cross-check.
export async function eventOverview() {
    const events = await prisma.event.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    const [tabs, dbApproved] = await Promise.all([
        readEventTabs(events.map((e) => e.name)),
        prisma.registration.groupBy({
            by: ["eventId"],
            where: { status: { in: ["APPROVED", "TICKET_ISSUED"] } },
            _count: { _all: true },
        }),
    ]);
    const dbCount = new Map(dbApproved.map((g) => [g.eventId, g._count._all]));
    const rows = events.map((event, i) => {
        const tab = tabs[i];
        const summary = tab.rows ? summarizeEventTab(tab.rows) : { approvedTeams: 0, approvedParticipants: 0, approvedAmountPaise: 0, totalRows: 0 };
        const databaseApprovedTeams = dbCount.get(event.id) ?? 0;
        return {
            eventId: event.id,
            name: event.name,
            tab: tab.tab,
            tabFound: tab.rows !== null,
            ...summary,
            databaseApprovedTeams,
            matchesDatabase: summary.approvedTeams === databaseApprovedTeams,
        };
    });
    const sum = (key: "approvedTeams" | "approvedParticipants" | "approvedAmountPaise") =>
        rows.reduce((total, row) => total + row[key], 0);
    return {
        source: "google-sheets" as const,
        readAt: new Date().toISOString(),
        events: rows,
        totals: {
            approvedTeams: sum("approvedTeams"),
            approvedParticipants: sum("approvedParticipants"),
            approvedAmountPaise: sum("approvedAmountPaise"),
        },
        allMatchDatabase: rows.every((row) => row.matchesDatabase),
    };
}
