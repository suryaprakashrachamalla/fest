import type { NextFunction, Request, Response } from "express";
import { prisma } from "./lib/prisma.ts";
import type { RegistrationStatus } from "./generated/prisma/client.ts";

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

// Paid means the organizers have verified the payment (it may since have been approved and ticketed).
const PAID: RegistrationStatus[] = ["PAYMENT_VERIFIED", "APPROVED", "TICKET_ISSUED"];

type EventTotals = {
    eventId: string;
    name: string;
    slug: string;
    registrations: number;
    participants: number;
    paidRegistrations: number;
    paidParticipants: number;
    collectedPaise: number;
    awaitingReviewPaise: number;
    byStatus: Partial<Record<RegistrationStatus, number>>;
};

// Per-event registration counts and money, plus overall totals, for the super admin overview.
export async function eventOverview() {
    const [events, groups] = await Promise.all([
        prisma.event.findMany({ select: { id: true, name: true, slug: true }, orderBy: { createdAt: "asc" } }),
        prisma.registration.groupBy({
            by: ["eventId", "status"],
            _count: { _all: true },
            _sum: { teamSize: true, amountPaise: true },
        }),
    ]);
    const rows = new Map<string, EventTotals>(
        events.map((e) => [
            e.id,
            {
                eventId: e.id,
                name: e.name,
                slug: e.slug,
                registrations: 0,
                participants: 0,
                paidRegistrations: 0,
                paidParticipants: 0,
                collectedPaise: 0,
                awaitingReviewPaise: 0,
                byStatus: {},
            },
        ]),
    );
    for (const g of groups) {
        const row = rows.get(g.eventId);
        if (!row) continue;
        const count = g._count._all;
        const people = g._sum.teamSize ?? 0;
        const amount = g._sum.amountPaise ?? 0;
        row.registrations += count;
        row.participants += people;
        row.byStatus[g.status] = count;
        if (PAID.includes(g.status)) {
            row.paidRegistrations += count;
            row.paidParticipants += people;
            row.collectedPaise += amount;
        }
        if (g.status === "PAYMENT_REVIEW") row.awaitingReviewPaise += amount;
    }
    const list = [...rows.values()];
    const sum = (key: "registrations" | "participants" | "paidRegistrations" | "paidParticipants" | "collectedPaise" | "awaitingReviewPaise") =>
        list.reduce((total, row) => total + row[key], 0);
    return {
        events: list,
        totals: {
            registrations: sum("registrations"),
            participants: sum("participants"),
            paidRegistrations: sum("paidRegistrations"),
            paidParticipants: sum("paidParticipants"),
            collectedPaise: sum("collectedPaise"),
            awaitingReviewPaise: sum("awaitingReviewPaise"),
        },
    };
}
