import { prisma } from "./lib/prisma.ts";
import { addOutbox } from "./lib/outbox.ts";

type ParticipantInput = { name?: unknown; college?: unknown; rollNumber?: unknown };

function normalizedCollege(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function validateParticipants(
    participants: ParticipantInput[],
    min: number,
    max: number,
) {
    if (participants.length < min || participants.length > max || participants.length > 4)
        throw Object.assign(
            new Error(`Team must have between ${min} and ${max} participants`),
            { status: 400 },
        );
    for (const participant of participants) {
        if (
            typeof participant.name !== "string" ||
            participant.name.trim().length < 2 ||
            typeof participant.college !== "string" ||
            participant.college.trim().length < 2
        )
            throw Object.assign(new Error("Every participant needs a name and college"), {
                status: 400,
            });
        const roll =
            typeof participant.rollNumber === "string"
                ? participant.rollNumber.trim()
                : "";
        // The supplied pattern uses X as a digit placeholder; MVSR roll numbers start with the fixed 2451-2 prefix.
        if (
            normalizedCollege(participant.college).includes("mvsr") &&
            !/^2451-2\d-\d{3}-\d{3}$/.test(roll)
        )
            throw Object.assign(
                new Error(
                    "MVSR roll numbers must match 2451-2X-XXX-XXX using digits in each X position",
                ),
                { status: 400 },
            );
        if (roll && roll.length > 40)
            throw Object.assign(new Error("Roll number is too long"), { status: 400 });
    }
}

function registrationRow(reg: {
    id: string;
    userId: string;
    eventId: string;
    event: { name: string };
    teamName: string;
    teamSize: number;
    amountPaise: number;
    verified: boolean;
    verifiedAt: Date | null;
    verifiedById: string | null;
    entryAllowed: boolean;
    entryAuthorizedAt: Date | null;
    entryAuthorizedById: string | null;
    entered: boolean;
    enteredAt: Date | null;
    enteredById: string | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        registrationId: reg.id,
        userId: reg.userId,
        eventId: reg.eventId,
        eventName: reg.event.name,
        teamName: reg.teamName,
        teamSize: reg.teamSize,
        amountPaise: reg.amountPaise,
        verified: reg.verified,
        verifiedAt: reg.verifiedAt?.toISOString() ?? "",
        verifiedById: reg.verifiedById ?? "",
        entryAllowed: reg.entryAllowed,
        entryAuthorizedAt: reg.entryAuthorizedAt?.toISOString() ?? "",
        entryAuthorizedById: reg.entryAuthorizedById ?? "",
        entered: reg.entered,
        enteredAt: reg.enteredAt?.toISOString() ?? "",
        enteredById: reg.enteredById ?? "",
        createdAt: reg.createdAt.toISOString(),
        updatedAt: reg.updatedAt.toISOString(),
    };
}
function participantRow(p: {
    id: string;
    registrationId: string;
    name: string;
    college: string;
    rollNumber: string | null;
    createdAt: Date;
}) {
    return {
        participantId: p.id,
        registrationId: p.registrationId,
        participantName: p.name,
        college: p.college,
        rollNumber: p.rollNumber ?? "",
        createdAt: p.createdAt.toISOString(),
    };
}

export async function createRegistration(
    userId: string,
    eventId: string,
    teamName: unknown,
    input: unknown,
) {
    if (
        typeof teamName !== "string" ||
        teamName.trim().length < 2 ||
        teamName.trim().length > 100 ||
        !Array.isArray(input)
    )
        throw Object.assign(new Error("teamName and participants are required"), {
            status: 400,
        });
    const participants = input as ParticipantInput[];
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || !event.isPublished)
        throw Object.assign(new Error("Event not found"), { status: 404 });
    validateParticipants(participants, event.minTeamSize, event.maxTeamSize);
    try {
        return await prisma.$transaction(async (tx) => {
            const registration = await tx.registration.create({
                data: {
                    userId,
                    eventId,
                    teamName: teamName.trim(),
                    teamSize: participants.length,
                    amountPaise: event.feePaise,
                },
                include: { event: true },
            });
            const createdParticipants = await Promise.all(
                participants.map((p) =>
                    tx.participant.create({
                        data: {
                            registrationId: registration.id,
                            name: String(p.name).trim(),
                            college: String(p.college).trim(),
                            rollNumber:
                                typeof p.rollNumber === "string" && p.rollNumber.trim()
                                    ? p.rollNumber.trim()
                                    : null,
                        },
                    }),
                ),
            );
            await addOutbox(
                tx,
                "REGISTRATION",
                registration.id,
                registrationRow(registration),
            );
            for (const participant of createdParticipants)
                await addOutbox(
                    tx,
                    "PARTICIPANT",
                    participant.id,
                    participantRow(participant),
                );
            return {
                ...registration,
                participants: createdParticipants,
                paymentInstructions: {
                    eventName: event.name,
                    teamName: registration.teamName,
                    registrationId: registration.id,
                    amountPaise: registration.amountPaise,
                    qrCodeUrl: process.env.PAYMENT_QR_URL ?? "/payment-qr.png",
                    instructions:
                        "Pay externally using the fest QR code, then upload your payment screenshot and UTR to this registration. Payment is verified manually.",
                },
            };
        });
    } catch (error) {
        if ((error as { code?: string }).code === "P2002")
            throw Object.assign(new Error("You are already registered for this event"), {
                status: 409,
            });
        throw error;
    }
}

export async function getMyRegistrations(userId: string) {
    return prisma.registration.findMany({
        where: { userId },
        include: {
            event: true,
            participants: true,
            paymentProofs: {
                select: {
                    id: true,
                    utr: true,
                    status: true,
                    submittedAt: true,
                    reviewedAt: true,
                    rejectionReason: true,
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function listAdminRegistrations() {
    return prisma.registration.findMany({
        where: { paymentProofs: { some: {} } },
        include: {
            event: true,
            user: { select: { id: true, name: true, email: true } },
            participants: true,
            paymentProofs: {
                select: {
                    id: true,
                    utr: true,
                    status: true,
                    submittedAt: true,
                    reviewedAt: true,
                    rejectionReason: true,
                },
                orderBy: { submittedAt: "desc" },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getRegistration(id: string, userId: string, isAdmin: boolean) {
    const registration = await prisma.registration.findUnique({
        where: { id },
        include: {
            event: true,
            participants: true,
            paymentProofs: {
                select: {
                    id: true,
                    utr: true,
                    screenshotMimeType: true,
                    screenshotFileName: true,
                    status: true,
                    reviewedById: true,
                    reviewedAt: true,
                    rejectionReason: true,
                    submittedAt: true,
                },
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

export { registrationRow };
