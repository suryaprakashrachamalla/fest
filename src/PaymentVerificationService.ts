import { prisma } from "./lib/prisma.ts";
import { addOutbox } from "./lib/outbox.ts";
import type { Express } from "express";

const proofSelection = {
    id: true,
    registrationId: true,
    utr: true,
    screenshotMimeType: true,
    screenshotFileName: true,
    status: true,
    reviewedById: true,
    reviewedAt: true,
    rejectionReason: true,
    submittedAt: true,
} as const;
function proofRow(p: {
    id: string;
    registrationId: string;
    utr: string;
    screenshotMimeType: string;
    status: string;
    reviewedById: string | null;
    reviewedAt: Date | null;
    rejectionReason: string | null;
    submittedAt: Date;
}) {
    return {
        proofId: p.id,
        registrationId: p.registrationId,
        utr: p.utr,
        screenshotMimeType: p.screenshotMimeType,
        status: p.status,
        reviewedById: p.reviewedById ?? "",
        reviewedAt: p.reviewedAt?.toISOString() ?? "",
        rejectionReason: p.rejectionReason ?? "",
        submittedAt: p.submittedAt.toISOString(),
        screenshotReference: `/admin/payment-proofs/${p.id}/screenshot`,
    };
}
function signature(bytes: Buffer, mime: string) {
    if (mime === "image/png")
        return (
            bytes.length >= 8 &&
            bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        );
    if (mime === "image/jpeg")
        return (
            bytes.length >= 3 &&
            bytes[0] === 0xff &&
            bytes[1] === 0xd8 &&
            bytes[2] === 0xff
        );
    return false;
}

export async function submitProof(
    registrationId: string,
    userId: string,
    utrValue: unknown,
    file?: Express.Multer.File,
) {
    const registration = await prisma.registration.findUnique({
        where: { id: registrationId },
    });
    if (!registration)
        throw Object.assign(new Error("Registration not found"), { status: 404 });
    if (registration.userId !== userId)
        throw Object.assign(new Error("You cannot access this registration"), {
            status: 403,
        });
    if (registration.verified)
        throw Object.assign(new Error("Payment has already been verified"), {
            status: 409,
        });
    if (typeof utrValue !== "string" || !/^[A-Za-z0-9-]{6,32}$/.test(utrValue.trim()))
        throw Object.assign(
            new Error("UTR must contain 6 to 32 letters, numbers, or hyphens"),
            { status: 400 },
        );
    if (
        !file ||
        file.size < 8 ||
        file.size > 5 * 1024 * 1024 ||
        !signature(file.buffer, file.mimetype)
    )
        throw Object.assign(
            new Error("Upload a valid PNG or JPEG image no larger than 5 MB"),
            { status: 400 },
        );
    try {
        return await prisma.$transaction(async (tx) => {
            const proof = await tx.paymentProof.create({
                data: {
                    registrationId,
                    utr: utrValue.trim(),
                    screenshotBytes: new Uint8Array(file.buffer),
                    screenshotMimeType: file.mimetype,
                    screenshotFileName: file.originalname.slice(0, 255),
                },
            });
            await addOutbox(tx, "PAYMENT_PROOF", proof.id, proofRow(proof));
            return { ...proofRow(proof) };
        });
    } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
            if ((error as { meta?: { target?: string[] } }).meta?.target?.includes("utr"))
                throw Object.assign(new Error("This UTR has already been submitted"), {
                    status: 409,
                });
            throw Object.assign(
                new Error("A payment proof is already pending for this registration"),
                { status: 409 },
            );
        }
        throw error;
    }
}

export async function listRegistrationProofs(
    registrationId: string,
    userId: string,
    isAdmin: boolean,
) {
    const registration = await prisma.registration.findUnique({
        where: { id: registrationId },
        select: { userId: true },
    });
    if (!registration)
        throw Object.assign(new Error("Registration not found"), { status: 404 });
    if (!isAdmin && registration.userId !== userId)
        throw Object.assign(new Error("You cannot access this registration"), {
            status: 403,
        });
    return prisma.paymentProof.findMany({
        where: { registrationId },
        select: proofSelection,
        orderBy: { submittedAt: "desc" },
    });
}
export async function getScreenshot(proofId: string, userId?: string, isAdmin = false) {
    const proof = await prisma.paymentProof.findUnique({
        where: { id: proofId },
        select: {
            screenshotBytes: true,
            screenshotMimeType: true,
            registration: { select: { userId: true } },
        },
    });
    if (!proof)
        throw Object.assign(new Error("Payment proof not found"), { status: 404 });
    if (!isAdmin && proof.registration.userId !== userId)
        throw Object.assign(new Error("You cannot access this payment proof"), {
            status: 403,
        });
    return { bytes: proof.screenshotBytes, mimeType: proof.screenshotMimeType };
}
export async function getAdminProof(proofId: string) {
    const proof = await prisma.paymentProof.findUnique({
        where: { id: proofId },
        select: {
            ...proofSelection,
            registration: { include: { event: true, participants: true } },
        },
    });
    if (!proof)
        throw Object.assign(new Error("Payment proof not found"), { status: 404 });
    return proof;
}
export async function listPending() {
    return prisma.registration.findMany({
        where: { paymentProofs: { some: { status: "PENDING" } } },
        include: {
            user: { select: { id: true, name: true, email: true } },
            event: true,
            participants: true,
            paymentProofs: { where: { status: "PENDING" }, select: proofSelection },
        },
        orderBy: { createdAt: "asc" },
    });
}
export async function reviewProof(
    proofId: string,
    adminId: string,
    action: "verify" | "reject",
    reason?: unknown,
) {
    if (
        action === "reject" &&
        (typeof reason !== "string" ||
            reason.trim().length < 3 ||
            reason.trim().length > 500)
    )
        throw Object.assign(
            new Error("A rejection reason between 3 and 500 characters is required"),
            { status: 400 },
        );
    return prisma.$transaction(async (tx) => {
        const proof = await tx.paymentProof.findUnique({ where: { id: proofId } });
        if (!proof)
            throw Object.assign(new Error("Payment proof not found"), { status: 404 });
        if (proof.status !== "PENDING")
            throw Object.assign(new Error("Only pending proofs can be reviewed"), {
                status: 409,
            });
        const changed = await tx.paymentProof.updateMany({
            where: { id: proofId, status: "PENDING" },
            data: {
                status: action === "verify" ? "VERIFIED" : "REJECTED",
                reviewedById: adminId,
                reviewedAt: new Date(),
                rejectionReason: action === "reject" ? String(reason).trim() : null,
            },
        });
        if (changed.count !== 1)
            throw Object.assign(new Error("Only pending proofs can be reviewed"), {
                status: 409,
            });
        const updated = await tx.paymentProof.findUniqueOrThrow({
            where: { id: proofId },
        });
        const registration =
            action === "verify"
                ? await tx.registration.update({
                      where: { id: proof.registrationId },
                      data: {
                          verified: true,
                          verifiedAt: new Date(),
                          verifiedById: adminId,
                      },
                      include: { event: true },
                  })
                : await tx.registration.findUniqueOrThrow({
                      where: { id: proof.registrationId },
                      include: { event: true },
                  });
        await addOutbox(tx, "PAYMENT_PROOF", updated.id, proofRow(updated));
        if (action === "verify") {
            const { registrationRow } = await import("./RegistrationsService.ts");
            await addOutbox(
                tx,
                "REGISTRATION",
                registration.id,
                registrationRow(registration),
            );
        }
        return {
            proof: proofRow(updated),
            registration: {
                id: registration.id,
                verified: registration.verified,
                verifiedAt: registration.verifiedAt,
                verifiedById: registration.verifiedById,
            },
        };
    });
}
