import { prisma } from "./lib/prisma.ts";
import { addOutbox } from "./lib/outbox.ts";
import { registrationRow } from "./RegistrationsService.ts";

export async function checkInStatus(id: string) {
    const reg = await prisma.registration.findUnique({
        where: { id },
        select: {
            id: true,
            verified: true,
            verifiedAt: true,
            entryAllowed: true,
            entryAuthorizedAt: true,
            entryAuthorizedById: true,
            entered: true,
            enteredAt: true,
            enteredById: true,
        },
    });
    if (!reg) throw Object.assign(new Error("Registration not found"), { status: 404 });
    return reg;
}
export async function checkIn(id: string, adminId: string) {
    return prisma.$transaction(async (tx) => {
        const current = await tx.registration.findUnique({
            where: { id },
            include: { event: true },
        });
        if (!current)
            throw Object.assign(new Error("Registration not found"), { status: 404 });
        if (!current.verified)
            throw Object.assign(
                new Error("Payment must be verified before admission and check-in"),
                { status: 409 },
            );
        if (current.entered)
            throw Object.assign(new Error("This team has already checked in"), {
                status: 409,
            });
        const result = await tx.registration.updateMany({
            where: { id, entered: false, verified: true },
            data: {
                entryAllowed: true,
                entryAuthorizedAt: current.entryAuthorizedAt ?? new Date(),
                entryAuthorizedById: current.entryAuthorizedById ?? adminId,
                entered: true,
                enteredAt: new Date(),
                enteredById: adminId,
            },
        });
        if (result.count !== 1)
            throw Object.assign(new Error("This team has already checked in"), {
                status: 409,
            });
        const updated = await tx.registration.findUniqueOrThrow({
            where: { id },
            include: { event: true },
        });
        await addOutbox(tx, "REGISTRATION", id, registrationRow(updated));
        return updated;
    });
}
