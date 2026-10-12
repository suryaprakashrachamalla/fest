import { prisma } from "./lib/prisma.ts";
import { addOutbox } from "./lib/outbox.ts";
import type { Express } from "express";
import { addAudit, queueRegistrationSync } from "./lib/registrationSync.ts";
import { uniqueViolation } from "./lib/prismaErrors.ts";

const PAYMENT_METHODS = ["UPI"];

const proofSelection = {
    id: true,
    registrationId: true,
    utr: true,
    paymentMethod: true,
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
    paymentMethod: string;
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
        paymentMethod: p.paymentMethod,
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
    paymentMethodValue: unknown = "UPI",
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
    if (registration.status === "PAYMENT_REVIEW")
        throw Object.assign(new Error("A payment proof is already pending for this registration"), {
            status: 409,
        });
    if (registration.status !== "PENDING_PAYMENT" && registration.status !== "PAYMENT_REJECTED")
        throw Object.assign(new Error("Payment proofs can no longer be submitted for this registration"), {
            status: 409,
        });
    const paymentMethod =
        typeof paymentMethodValue === "string" && paymentMethodValue.trim()
            ? paymentMethodValue.trim().toUpperCase()
            : "UPI";
    if (!PAYMENT_METHODS.includes(paymentMethod))
        throw Object.assign(new Error("Unsupported payment method"), { status: 400 });
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
    // A rejected UTR may come back only on the registration it was rejected for (e.g. with a
    // clearer screenshot); live UTRs are kept unique by the database.
    const rejectedElsewhere = await prisma.paymentProof.findFirst({
        where: { utr: utrValue.trim(), status: "REJECTED", registrationId: { not: registrationId } },
        select: { id: true },
    });
    if (rejectedElsewhere)
        throw Object.assign(new Error("This UTR has already been submitted"), { status: 409 });
    try {
        return await prisma.$transaction(async (tx) => {
            const proof = await tx.paymentProof.create({
                data: {
                    registrationId,
                    utr: utrValue.trim(),
                    paymentMethod,
                    screenshotBytes: new Uint8Array(file.buffer),
                    screenshotMimeType: file.mimetype,
                    screenshotFileName: file.originalname.slice(0, 255),
                },
            });
            // The UTR is only a claim; the registration moves to review, never straight to verified.
            const moved = await tx.registration.updateMany({
                where: { id: registrationId, status: registration.status },
                data: { status: "PAYMENT_REVIEW" },
            });
            if (moved.count !== 1)
                throw Object.assign(new Error("This registration changed; refresh and try again"), {
                    status: 409,
                });
            await addAudit(tx, {
                registrationId,
                actorId: userId,
                action: "PAYMENT_SUBMITTED",
                fromStatus: registration.status,
                toStatus: "PAYMENT_REVIEW",
                detail: `${paymentMethod} UTR ${utrValue.trim()}`,
            });
            await addOutbox(tx, "PAYMENT_PROOF", proof.id, proofRow(proof));
            await queueRegistrationSync(tx, registrationId);
            return { ...proofRow(proof) };
        });
    } catch (error) {
        const violated = uniqueViolation(error);
        if (violated !== null) {
            if (violated.includes("utr"))
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
            // Ticket codes stay out of admin lists: they are only ever needed inside the QR itself.
            registration: { include: { event: true, participants: { omit: { ticketCode: true, checkInScanId: true } } } },
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
            participants: { omit: { ticketCode: true, checkInScanId: true } },
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
        const before = await tx.registration.findUniqueOrThrow({
            where: { id: proof.registrationId },
            select: { status: true },
        });
        if (before.status !== "PAYMENT_REVIEW")
            throw Object.assign(new Error("This registration is not awaiting payment review"), {
                status: 409,
            });
        const toStatus = action === "verify" ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED";
        await tx.registration.update({
            where: { id: proof.registrationId },
            data:
                action === "verify"
                    ? { status: toStatus, verified: true, verifiedAt: new Date(), verifiedById: adminId }
                    : { status: toStatus },
        });
        await addAudit(tx, {
            registrationId: proof.registrationId,
            actorId: adminId,
            action: action === "verify" ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED",
            fromStatus: "PAYMENT_REVIEW",
            toStatus,
            detail: action === "reject" ? String(reason).trim() : `UTR ${proof.utr}`,
        });
        await addOutbox(tx, "PAYMENT_PROOF", updated.id, proofRow(updated));
        const registration = await queueRegistrationSync(tx, proof.registrationId);
        return {
            proof: proofRow(updated),
            registration: {
                id: registration.id,
                status: registration.status,
                verified: registration.verified,
                verifiedAt: registration.verifiedAt,
                verifiedById: registration.verifiedById,
            },
        };
    });
}
