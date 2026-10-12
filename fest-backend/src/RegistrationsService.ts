import { prisma } from "./lib/prisma.ts";
import { uniqueViolation } from "./lib/prismaErrors.ts";
import { addOutbox } from "./lib/outbox.ts";
import { reviewProof } from "./PaymentVerificationService.ts";
import type { RegistrationStatus } from "./generated/prisma/client.ts";
import {
    addAudit,
    generateRegistrationCode,
    participantRow,
    queueRegistrationSync,
} from "./lib/registrationSync.ts";

type ParticipantInput = {
    name?: unknown;
    email?: unknown;
    college?: unknown;
    rollNumber?: unknown;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUSES: RegistrationStatus[] = [
    "PENDING_PAYMENT",
    "PAYMENT_REVIEW",
    "PAYMENT_VERIFIED",
    "APPROVED",
    "TICKET_ISSUED",
    "PAYMENT_REJECTED",
    "REJECTED",
];

function badRequest(message: string) {
    return Object.assign(new Error(message), { status: 400 });
}

function normalizedCollege(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

// Accepts 10-digit Indian mobile numbers with an optional +91 or 0 prefix; stored as +91XXXXXXXXXX.
export function normalizePhone(value: unknown) {
    if (typeof value !== "string") throw badRequest("A valid phone number is required");
    const digits = value.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(digits))
        throw badRequest("Enter a valid 10-digit Indian mobile number");
    return `+91${digits}`;
}

function validateParticipants(
    participants: ParticipantInput[],
    teamCollege: string,
    min: number,
    max: number,
) {
    if (participants.length < min || participants.length > max || participants.length > 4)
        throw badRequest(`Team must have between ${min} and ${max} participants`);
    const seenEmails = new Set<string>();
    return participants.map((participant, index) => {
        const label = `Student ${index + 1}`;
        if (typeof participant.name !== "string" || participant.name.trim().length < 2)
            throw badRequest(`${label} needs a name`);
        if (participant.name.trim().length > 100) throw badRequest(`${label}'s name is too long`);
        const email = typeof participant.email === "string" ? participant.email.trim().toLowerCase() : "";
        if (!EMAIL_PATTERN.test(email) || email.length > 254)
            throw badRequest(`${label} needs a valid email address`);
        if (seenEmails.has(email)) throw badRequest("Each student needs a different email address");
        seenEmails.add(email);
        // A per-student college is still accepted for older clients; otherwise the team college applies.
        const college =
            typeof participant.college === "string" && participant.college.trim()
                ? participant.college.trim()
                : teamCollege;
        const roll = typeof participant.rollNumber === "string" ? participant.rollNumber.trim() : "";
        // The supplied pattern uses X as a digit placeholder; MVSR roll numbers start with the fixed 2451-2 prefix.
        if (normalizedCollege(college).includes("mvsr") && !/^2451-2\d-\d{3}-\d{3}$/.test(roll))
            throw badRequest(
                `${label}: MVSR roll numbers must match 2451-2X-XXX-XXX using digits in each X position`,
            );
        if (roll.length > 40) throw badRequest(`${label}'s roll number is too long`);
        return { name: participant.name.trim(), email, college, rollNumber: roll || null };
    });
}

export function registrationFee(event: { feePaise: number; feeMode: string }, teamSize: number) {
    return event.feeMode === "PER_HEAD" ? event.feePaise * teamSize : event.feePaise;
}

function conflictMessage(fields: string) {
    if (fields.includes("email")) return "One of these students is already registered for this event";
    if (fields.includes("code")) return null;
    return "You are already registered for this event";
}

export async function createRegistration(
    userId: string,
    eventId: string,
    body: { teamName?: unknown; college?: unknown; phone?: unknown; participants?: unknown },
) {
    const { teamName, college, phone, participants: input } = body;
    if (!Array.isArray(input)) throw badRequest("participants are required");
    if (typeof college !== "string" || college.trim().length < 2 || college.trim().length > 150)
        throw badRequest("College name is required");
    const normalizedPhone = normalizePhone(phone);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || !event.isPublished)
        throw Object.assign(new Error("Event not found"), { status: 404 });
    // Individual events (one person per registration) have no team; any team name sent is ignored.
    const individual = event.maxTeamSize === 1;
    if (
        !individual &&
        (typeof teamName !== "string" || teamName.trim().length < 2 || teamName.trim().length > 100)
    )
        throw badRequest("A team name between 2 and 100 characters is required");
    const participants = validateParticipants(
        input as ParticipantInput[],
        college.trim(),
        event.minTeamSize,
        event.maxTeamSize,
    );
    // The fee is always computed server-side; any client-supplied amount is ignored.
    const amountPaise = registrationFee(event, participants.length);

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await prisma.$transaction(async (tx) => {
                const registration = await tx.registration.create({
                    data: {
                        code: generateRegistrationCode(),
                        userId,
                        eventId,
                        teamName: individual ? null : (teamName as string).trim(),
                        teamSize: participants.length,
                        college: college.trim(),
                        phone: normalizedPhone,
                        amountPaise,
                    },
                });
                const createdParticipants = [];
                for (const p of participants)
                    createdParticipants.push(
                        await tx.participant.create({
                            data: { registrationId: registration.id, eventId, ...p },
                        }),
                    );
                await addAudit(tx, {
                    registrationId: registration.id,
                    actorId: userId,
                    action: "REGISTERED",
                    toStatus: "PENDING_PAYMENT",
                });
                const synced = await queueRegistrationSync(tx, registration.id);
                for (const participant of createdParticipants)
                    await addOutbox(tx, "PARTICIPANT", participant.id, participantRow(participant));
                return {
                    ...synced,
                    paymentInstructions: {
                        eventName: event.name,
                        teamName: registration.teamName,
                        registrationId: registration.id,
                        registrationCode: registration.code,
                        amountPaise,
                        qrCodeUrl: "/payment-qr/active/image",
                        instructions:
                            "Pay the exact amount using the fest UPI QR code, then submit the UTR and a payment screenshot. Payment is verified manually by the organizers.",
                    },
                };
            });
        } catch (error) {
            const violated = uniqueViolation(error);
            if (violated !== null) {
                const message = conflictMessage(violated);
                if (message === null) continue; // registration code collision: retry with a new code
                throw Object.assign(new Error(message), { status: 409 });
            }
            throw error;
        }
    }
    throw new Error("Could not allocate a unique registration code");
}

const participantSelect = {
    id: true,
    name: true,
    email: true,
    college: true,
    rollNumber: true,
    lumaCheckedInAt: true,
    // Ticket progress only; the ticket code itself is never sent in lists.
    ticketEmailedAt: true,
    ticketEmailError: true,
    checkedInAt: true,
    checkedInBy: { select: { name: true } },
} as const;
const proofSelect = {
    id: true,
    utr: true,
    paymentMethod: true,
    status: true,
    submittedAt: true,
    reviewedAt: true,
    rejectionReason: true,
} as const;

export async function getMyRegistrations(userId: string) {
    return prisma.registration.findMany({
        where: { userId },
        include: {
            event: true,
            participants: { select: participantSelect, orderBy: { createdAt: "asc" } },
            paymentProofs: { select: proofSelect, orderBy: { submittedAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function listAdminRegistrations(statusFilter?: unknown) {
    const status =
        typeof statusFilter === "string" && STATUSES.includes(statusFilter as RegistrationStatus)
            ? (statusFilter as RegistrationStatus)
            : undefined;
    return prisma.registration.findMany({
        where: status ? { status } : undefined,
        include: {
            event: true,
            user: { select: { id: true, name: true, email: true } },
            verifiedBy: { select: { name: true, email: true } },
            approvedBy: { select: { name: true, email: true } },
            participants: { select: participantSelect, orderBy: { createdAt: "asc" } },
            paymentProofs: { select: proofSelect, orderBy: { submittedAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getRegistration(id: string, userId: string, isAdmin: boolean) {
    const registration = await prisma.registration.findUnique({
        where: { id },
        include: {
            event: true,
            participants: { select: participantSelect, orderBy: { createdAt: "asc" } },
            paymentProofs: {
                select: {
                    ...proofSelect,
                    screenshotMimeType: true,
                    screenshotFileName: true,
                    reviewedById: true,
                },
                orderBy: { submittedAt: "desc" },
            },
        },
    });
    if (!registration)
        throw Object.assign(new Error("Registration not found"), { status: 404 });
    if (!isAdmin && registration.userId !== userId)
        throw Object.assign(new Error("You cannot access this registration"), {
            status: 403,
        });
    return registration;
}

// Organizer approval is separate from payment verification and requires a verified payment.
// Repeated clicks are harmless: an already-approved registration is returned unchanged.
export async function approveRegistration(id: string, adminId: string) {
    return prisma.$transaction(async (tx) => {
        const current = await tx.registration.findUnique({ where: { id } });
        if (!current) throw Object.assign(new Error("Registration not found"), { status: 404 });
        if (current.status === "APPROVED" || current.status === "TICKET_ISSUED")
            return { registration: current, alreadyApproved: true };
        if (current.status !== "PAYMENT_VERIFIED")
            throw Object.assign(new Error("Verify the payment before approving this registration"), {
                status: 409,
            });
        const now = new Date();
        const changed = await tx.registration.updateMany({
            where: { id, status: "PAYMENT_VERIFIED" },
            data: {
                status: "APPROVED",
                approvedAt: now,
                approvedById: adminId,
                entryAllowed: true,
                entryAuthorizedAt: now,
                entryAuthorizedById: adminId,
            },
        });
        if (changed.count !== 1)
            throw Object.assign(new Error("This registration was changed by someone else; refresh and try again"), {
                status: 409,
            });
        await addAudit(tx, {
            registrationId: id,
            actorId: adminId,
            action: "APPROVED",
            fromStatus: "PAYMENT_VERIFIED",
            toStatus: "APPROVED",
        });
        const registration = await queueRegistrationSync(tx, id);
        return { registration, alreadyApproved: false };
    });
}

// One-click organizer approval from the admin panel: verifies the pending payment proof the organizer
// has just checked (screenshot and UTR), then approves. Approval is what emails each member their QR.
export async function approveWithPayment(id: string, adminId: string) {
    const current = await prisma.registration.findUnique({
        where: { id },
        select: { status: true, paymentProofs: { where: { status: "PENDING" }, select: { id: true }, take: 1 } },
    });
    if (!current) throw Object.assign(new Error("Registration not found"), { status: 404 });
    if (current.status === "PAYMENT_REVIEW") {
        const proof = current.paymentProofs[0];
        if (!proof) throw Object.assign(new Error("There is no payment proof to verify"), { status: 409 });
        try {
            await reviewProof(proof.id, adminId, "verify");
        } catch (error) {
            // Another organizer reviewed it a moment ago; approval below re-checks the current status.
            if ((error as { status?: number }).status !== 409) throw error;
        }
    }
    return approveRegistration(id, adminId);
}

export async function rejectRegistration(id: string, adminId: string, reason: unknown) {
    if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 500)
        throw badRequest("A rejection reason between 3 and 500 characters is required");
    return prisma.$transaction(async (tx) => {
        const current = await tx.registration.findUnique({ where: { id } });
        if (!current) throw Object.assign(new Error("Registration not found"), { status: 404 });
        if (current.status === "REJECTED")
            throw Object.assign(new Error("This registration is already rejected"), { status: 409 });
        if (current.status === "TICKET_ISSUED" || current.entered)
            throw Object.assign(new Error("A registration with an issued ticket or check-in cannot be rejected"), {
                status: 409,
            });
        const changed = await tx.registration.updateMany({
            where: { id, status: current.status },
            data: {
                status: "REJECTED",
                rejectionReason: reason.trim(),
                entryAllowed: false,
            },
        });
        if (changed.count !== 1)
            throw Object.assign(new Error("This registration was changed by someone else; refresh and try again"), {
                status: 409,
            });
        // Close any proof still waiting for review so it cannot be verified afterwards.
        await tx.paymentProof.updateMany({
            where: { registrationId: id, status: "PENDING" },
            data: {
                status: "REJECTED",
                reviewedById: adminId,
                reviewedAt: new Date(),
                rejectionReason: "Registration rejected",
            },
        });
        await addAudit(tx, {
            registrationId: id,
            actorId: adminId,
            action: "REJECTED",
            fromStatus: current.status,
            toStatus: "REJECTED",
            detail: reason.trim(),
        });
        return queueRegistrationSync(tx, id);
    });
}

export async function getAuditHistory(id: string) {
    const exists = await prisma.registration.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw Object.assign(new Error("Registration not found"), { status: 404 });
    return prisma.auditLog.findMany({
        where: { registrationId: id },
        include: { actor: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: "asc" },
    });
}
