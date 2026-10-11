import { randomInt } from "node:crypto";
import type { Prisma, RegistrationStatus } from "../generated/prisma/client.ts";
import { addOutbox } from "./outbox.ts";

// Unambiguous characters only (no 0/O, 1/I/L) so codes are easy to read out at the help desk.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRegistrationCode() {
    let suffix = "";
    for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return `SG26-${suffix}`;
}

export const registrationSyncInclude = {
    event: true,
    participants: { orderBy: { createdAt: "asc" } },
    paymentProofs: {
        select: { utr: true, paymentMethod: true, status: true, submittedAt: true },
        orderBy: { submittedAt: "desc" },
    },
    verifiedBy: { select: { name: true, email: true } },
    approvedBy: { select: { name: true, email: true } },
    // Latest rejection (payment or registration) and who made it.
    auditEntries: {
        where: { action: { in: ["REJECTED", "PAYMENT_REJECTED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { actor: { select: { name: true, email: true } } },
    },
} as const satisfies Prisma.RegistrationInclude;

type RegistrationForSheet = Prisma.RegistrationGetPayload<{
    include: typeof registrationSyncInclude;
}>;

function person(user: { name: string; email: string } | null | undefined) {
    return user ? `${user.name} <${user.email}>` : "";
}

function approvalStatus(status: RegistrationStatus) {
    if (status === "APPROVED" || status === "TICKET_ISSUED") return "APPROVED";
    if (status === "REJECTED") return "REJECTED";
    return "PENDING";
}

// Entry QR emails go to each member after approval; Luma is the older, optional ticket path.
function ticketEmailStatus(reg: RegistrationForSheet) {
    const total = reg.participants.length;
    const sent = reg.participants.filter((p) => p.ticketEmailedAt).length;
    const failed = reg.participants.find((p) => !p.ticketEmailedAt && p.ticketEmailError);
    if (failed) return `FAILED (${sent}/${total} sent): ${failed.ticketEmailError}`;
    if (sent) return sent === total ? `SENT ${sent}/${total}` : `SENDING ${sent}/${total}`;
    if (reg.lumaSyncedAt) return "SENT_BY_LUMA";
    if (reg.lumaError) return `LUMA_FAILED: ${reg.lumaError}`;
    return "NOT_SENT";
}

// One row per registration in the "Registrations" worksheet, keyed by the registration code.
export function registrationSheetRow(reg: RegistrationForSheet) {
    const latestProof = reg.paymentProofs[0];
    const membersIn = reg.participants.filter((p) => p.checkedInAt).length;
    return {
        registrationId: reg.code,
        internalId: reg.id,
        participantNames: reg.participants.map((p) => p.name).join(", "),
        emails: reg.participants.map((p) => p.email).join(", "),
        phone: reg.phone,
        college: reg.college,
        event: reg.event.name,
        teamName: reg.teamName,
        teamSize: reg.teamSize,
        registrationFee: (reg.amountPaise / 100).toFixed(2),
        paymentMethod: latestProof?.paymentMethod ?? "",
        utr: latestProof?.utr ?? "",
        paymentStatus: latestProof?.status ?? "NOT_SUBMITTED",
        approvalStatus: approvalStatus(reg.status),
        status: reg.status,
        rejectionReason: reg.rejectionReason ?? "",
        paymentVerifiedBy: person(reg.verifiedBy),
        paymentVerifiedAt: reg.verifiedAt?.toISOString() ?? "",
        approvedBy: person(reg.approvedBy),
        approvedAt: reg.approvedAt?.toISOString() ?? "",
        rejectedBy: person(reg.auditEntries[0]?.actor),
        registeredAt: reg.createdAt.toISOString(),
        // Guest IDs (gst-...) arrive with the Luma guest-list import; until then the column shows when they were added.
        lumaGuestId:
            reg.participants.map((p) => p.lumaGuestId).filter(Boolean).join(", ") ||
            (reg.lumaSyncedAt ? `ADDED ${reg.lumaSyncedAt.toISOString()}` : ""),
        ticketStatus: reg.status === "TICKET_ISSUED" ? "ISSUED" : "NOT_ISSUED",
        emailStatus: ticketEmailStatus(reg),
        // Members are scanned one by one at the entrance; the team counts as entered with its first member.
        checkedIn: membersIn ? `${membersIn}/${reg.participants.length} entered` : reg.entered,
        checkedInAt: reg.enteredAt?.toISOString() ?? "",
        updatedAt: reg.updatedAt.toISOString(),
    };
}

export function participantRow(p: {
    id: string;
    registrationId: string;
    name: string;
    email: string;
    college: string;
    rollNumber: string | null;
    createdAt: Date;
    ticketEmailedAt?: Date | null;
    ticketEmailError?: string | null;
    checkedInAt?: Date | null;
}) {
    return {
        participantId: p.id,
        registrationId: p.registrationId,
        participantName: p.name,
        email: p.email,
        college: p.college,
        rollNumber: p.rollNumber ?? "",
        createdAt: p.createdAt.toISOString(),
        // This member's own entry QR email and entrance scan.
        ticketEmailStatus: p.ticketEmailedAt ? "SENT" : p.ticketEmailError ? `FAILED: ${p.ticketEmailError}` : "NOT_SENT",
        ticketEmailedAt: p.ticketEmailedAt?.toISOString() ?? "",
        checkedInAt: p.checkedInAt?.toISOString() ?? "",
    };
}

// Queues this member's row in the Participants worksheet.
export async function queueParticipantSync(tx: Prisma.TransactionClient, participantId: string) {
    const participant = await tx.participant.findUniqueOrThrow({ where: { id: participantId } });
    await addOutbox(tx, "PARTICIPANT", participant.id, participantRow(participant));
}

// Reloads the registration inside the transaction so the queued row always reflects committed state.
export async function queueRegistrationSync(tx: Prisma.TransactionClient, registrationId: string) {
    const reg = await tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
        include: registrationSyncInclude,
    });
    // Keyed by the code, the Registrations sheet's row ID (reconciliation uses the same key).
    await addOutbox(tx, "REGISTRATION", reg.code, registrationSheetRow(reg));
    return reg;
}

export async function addAudit(
    tx: Prisma.TransactionClient,
    entry: {
        registrationId: string;
        actorId?: string | null;
        action: string;
        fromStatus?: RegistrationStatus | null;
        toStatus?: RegistrationStatus | null;
        detail?: string | null;
    },
) {
    await tx.auditLog.create({
        data: {
            registrationId: entry.registrationId,
            actorId: entry.actorId ?? null,
            action: entry.action,
            fromStatus: entry.fromStatus ?? null,
            toStatus: entry.toStatus ?? null,
            detail: entry.detail ?? null,
        },
    });
}
