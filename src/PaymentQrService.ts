import { randomUUID } from "node:crypto";
import { prisma } from "./lib/prisma.ts";
import type { Express } from "express";

const MAX_QR_BYTES = 5 * 1024 * 1024;

function hasValidImageSignature(bytes: Buffer, mimeType: string) {
    if (mimeType === "image/png")
        return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === "image/jpeg")
        return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    return false;
}

export async function getActiveQr() {
    return prisma.paymentQrCode.findFirst({
        where: { isActive: true },
        select: { id: true, label: true, mimeType: true },
    });
}

export async function listQrCodes() {
    return prisma.paymentQrCode.findMany({
        select: { id: true, label: true, mimeType: true, isActive: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });
}

export async function getQrImage(id: string) {
    const qr = await prisma.paymentQrCode.findUnique({
        where: { id },
        select: { imageBytes: true, mimeType: true },
    });
    if (!qr) throw Object.assign(new Error("Payment QR code not found"), { status: 404 });
    return qr;
}

export async function getActiveQrImage() {
    const qr = await prisma.paymentQrCode.findFirst({
        where: { isActive: true },
        select: { imageBytes: true, mimeType: true },
    });
    if (!qr) throw Object.assign(new Error("No payment QR code is active"), { status: 404 });
    return qr;
}

export async function createQrCode(labelValue: unknown, file?: Express.Multer.File) {
    const label = typeof labelValue === "string" ? labelValue.trim() : "";
    if (!label || label.length > 80)
        throw Object.assign(new Error("QR code name must be between 1 and 80 characters"), { status: 400 });
    if (!file || file.size < 8 || file.size > MAX_QR_BYTES || !hasValidImageSignature(file.buffer, file.mimetype))
        throw Object.assign(new Error("Upload a valid PNG or JPEG image no larger than 5 MB"), { status: 400 });
    return prisma.paymentQrCode.create({
        data: {
            id: randomUUID(),
            label,
            imageBytes: new Uint8Array(file.buffer),
            mimeType: file.mimetype,
        },
        select: { id: true, label: true, mimeType: true, isActive: true, createdAt: true },
    });
}

export async function setQrActive(id: string, isActive: unknown) {
    if (typeof isActive !== "boolean")
        throw Object.assign(new Error("isActive must be true or false"), { status: 400 });
    return prisma.$transaction(async (tx) => {
        const qr = await tx.paymentQrCode.findUnique({ where: { id } });
        if (!qr) throw Object.assign(new Error("Payment QR code not found"), { status: 404 });
        if (isActive) await tx.paymentQrCode.updateMany({ data: { isActive: false } });
        return tx.paymentQrCode.update({
            where: { id },
            data: { isActive },
            select: { id: true, label: true, mimeType: true, isActive: true, createdAt: true },
        });
    });
}
