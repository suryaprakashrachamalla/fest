// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { prisma } from "./lib/prisma.ts";
import { setDriveClientForTests } from "./lib/driveStorage.ts";
import { createFakeDrive } from "./testing/fakeDrive.ts";
import * as registrations from "./RegistrationsService.ts";

// Payment screenshots moving from the database to Google Drive (an in-memory fake, never Google).
const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;
const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const archive = await import("./ScreenshotArchiveService.ts");
const { default: app } = await import("./app.ts");
const drive = createFakeDrive();

const runId = crypto.randomUUID().slice(0, 8);
const eventName = `Shot Event ${runId}`;
const ids = { event: "", users: {} as Record<string, string> };
let server: Server;
let base = "";
// A real (tiny) PNG and JPEG: the server checks the file signature.
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(`png-${runId}`)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpg-${runId}-longer-body`)]);

const token = (label: string) =>
    jwt.sign({ sub: ids.users[label] }, process.env.JWT_SECRET!, { issuer: "fest-registration", algorithm: "HS256", expiresIn: "1h" });
async function user(label: string, role: "USER" | "ADMIN" = "USER") {
    ids.users[label] = (await prisma.user.create({ data: { name: label, email: `${label}-${runId}@mvsr.test`, passwordHash: "x", role } })).id;
}
// Registers through the service and uploads the payment proof over HTTP, like the site does.
async function registerAndPay(label: string, image: Buffer, type: "image/png" | "image/jpeg") {
    await user(label);
    const reg = await registrations.createRegistration(ids.users[label], ids.event, {
        teamName: `Team ${label}`,
        college: "Test College",
        phone: "9876543210",
        participants: [{ name: `${label} one`, email: `${label}-p-${runId}@mvsr.test` }],
    });
    const form = new FormData();
    form.append("utr", `UTR${label}${runId}`.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 30));
    form.append("screenshot", new Blob([new Uint8Array(image)], { type }), type === "image/png" ? "pay.png" : "pay.jpg");
    const response = await fetch(`${base}/registrations/${reg.id}/payment-proofs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token(label)}` },
        body: form,
    });
    expect(response.status).toBe(201);
    const proofId = ((await response.json()) as { data: { proofId: string } }).data.proofId;
    return { reg, proofId };
}
const viewAs = (who: string, proofId: string) =>
    fetch(`${base}/admin/payment-proofs/${proofId}/screenshot`, { headers: { Authorization: `Bearer ${token(who)}` } });
const proofRow = (id: string) =>
    prisma.paymentProof.findUniqueOrThrow({ where: { id }, select: { screenshotBytes: true, driveFileId: true, driveError: true, driveAttemptAt: true } });
// Makes a claimed proof look old, as if the retry wait had passed.
const expireClaim = (id: string) => prisma.paymentProof.update({ where: { id }, data: { driveAttemptAt: new Date(Date.now() - 10 * 60_000) } });

beforeAll(async () => {
    if (!enabled) return;
    setDriveClientForTests(drive.client);
    // Older proofs in the shared test database aren't part of these tests.
    await prisma.paymentProof.updateMany({ where: { driveFileId: null }, data: { driveAttemptAt: new Date(Date.now() + 3_600_000) } });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    ids.event = (await prisma.event.create({
        data: { name: eventName, slug: `shot-${runId}`, feePaise: 10_000, minTeamSize: 1, maxTeamSize: 2, isPublished: true },
    })).id;
    await user("organizer", "ADMIN");
    await user("stranger");
});

afterAll(async () => {
    if (!enabled) return;
    server?.close();
    setDriveClientForTests(null);
    const regs = await prisma.registration.findMany({ where: { eventId: ids.event }, select: { id: true, code: true } });
    const regIds = regs.map((r) => r.id);
    const members = await prisma.participant.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } });
    const proofs = await prisma.paymentProof.findMany({ where: { registrationId: { in: regIds } }, select: { id: true } });
    await prisma.spreadsheetSyncOutbox.deleteMany({
        where: { entityId: { in: [...regIds, ...regs.map((r) => r.code), ...members.map((m) => m.id), ...proofs.map((p) => p.id), ...Object.values(ids.users)] } },
    });
    await prisma.paymentProof.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.auditLog.deleteMany({ where: { registrationId: { in: regIds } } });
    await prisma.registration.deleteMany({ where: { id: { in: regIds } } });
    await prisma.event.deleteMany({ where: { id: ids.event } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids.users) } } });
    await prisma.paymentProof.updateMany({ where: { driveFileId: null, driveAttemptAt: { gt: new Date() } }, data: { driveAttemptAt: null } });
});

describe("payment screenshots in Google Drive", () => {
    integrationTest("an uploaded screenshot is copied to the event's Drive folder, then removed from the database", async () => {
        const { reg, proofId } = await registerAndPay("png", PNG, "image/png");
        expect((await proofRow(proofId)).screenshotBytes?.length).toBe(PNG.length);

        const result = await archive.archivePendingScreenshots();
        expect(result).toEqual({ moved: 1, failed: [] });
        const row = await proofRow(proofId);
        expect(row.screenshotBytes).toBeNull();
        expect(row.driveFileId).toBeString();

        const file = drive.files.get(row.driveFileId!)!;
        expect(drive.pathOf(file)).toBe(`SHOURYA'26 payment screenshots/${eventName}/${reg.code}_UTRPNG${runId.toUpperCase()}.png`);
        expect(file.bytes.equals(PNG)).toBe(true);
        expect(file.appProperties.proofId).toBe(proofId);
    });

    integrationTest("organizers and the registrant still see the screenshot, now read from Drive; others can't", async () => {
        const { reg, proofId } = await registerAndPay("view", JPG, "image/jpeg");
        await archive.archivePendingScreenshots();

        const admin = await viewAs("organizer", proofId);
        expect(admin.status).toBe(200);
        expect(admin.headers.get("content-type")).toContain("image/jpeg");
        expect(Buffer.from(await admin.arrayBuffer()).equals(JPG)).toBe(true);
        const own = await fetch(`${base}/registrations/${reg.id}/payment-proofs/${proofId}/screenshot`, {
            headers: { Authorization: `Bearer ${token("view")}` },
        });
        expect(Buffer.from(await own.arrayBuffer()).equals(JPG)).toBe(true);
        expect((await viewAs("stranger", proofId)).status).toBe(403);
        const notOwner = await fetch(`${base}/registrations/${reg.id}/payment-proofs/${proofId}/screenshot`, {
            headers: { Authorization: `Bearer ${token("stranger")}` },
        });
        expect(notOwner.status).toBe(403);
        expect((await fetch(`${base}/admin/payment-proofs/${proofId}/screenshot`)).status).toBe(401);
    });

    integrationTest("if Drive fails, the screenshot stays in the database and is copied on a later try", async () => {
        const { proofId } = await registerAndPay("outage", PNG, "image/png");
        drive.failures.nextUpload = Object.assign(new Error("backendError"), { code: 503 });
        const first = await archive.archivePendingScreenshots();
        expect(first.moved).toBe(0);
        expect(first.failed[0]).toMatchObject({ proofId, error: "backendError" });
        let row = await proofRow(proofId);
        expect(row.screenshotBytes?.length).toBe(PNG.length);
        expect(row.driveError).toBe("backendError");
        // Still viewable meanwhile, from the database.
        expect(Buffer.from(await (await viewAs("organizer", proofId)).arrayBuffer()).equals(PNG)).toBe(true);

        // Not retried straight away...
        expect((await archive.archivePendingScreenshots()).moved).toBe(0);
        // ...but after the wait.
        await expireClaim(proofId);
        expect((await archive.archivePendingScreenshots()).moved).toBe(1);
        row = await proofRow(proofId);
        expect(row).toMatchObject({ screenshotBytes: null, driveError: null });
    });

    integrationTest("a copy Drive reports with the wrong size doesn't count, and the database keeps the original", async () => {
        const { proofId } = await registerAndPay("size", JPG, "image/jpeg");
        drive.failures.wrongSize = true;
        const result = await archive.archivePendingScreenshots();
        expect(result.failed[0].error).toMatch(/instead of/);
        expect((await proofRow(proofId)).screenshotBytes?.length).toBe(JPG.length);
    });

    integrationTest("a copy that reached Drive before the server stopped is reused, not uploaded twice", async () => {
        const { proofId } = await registerAndPay("resume", PNG, "image/png");
        // As if a previous attempt uploaded the file and the server stopped before recording it.
        const parentCount = drive.uploads().length;
        await drive.client.files.create({
            requestBody: { name: "earlier.png", parents: ["root"], appProperties: { proofId } },
            media: { mimeType: "image/png", body: (await import("node:stream")).Readable.from(PNG) },
        } as never);
        expect((await archive.archivePendingScreenshots()).moved).toBe(1);
        expect(drive.uploads().length).toBe(parentCount + 1);
        expect(drive.files.get((await proofRow(proofId)).driveFileId!)!.name).toBe("earlier.png");
    });

    integrationTest("two servers copying at the same moment upload each screenshot once", async () => {
        const { proofId } = await registerAndPay("race", JPG, "image/jpeg");
        const before = drive.uploads().length;
        const [a, b] = await Promise.all([archive.archivePendingScreenshots(), archive.archivePendingScreenshots()]);
        expect(a.moved + b.moved).toBe(1);
        expect(drive.uploads().length).toBe(before + 1);
        expect((await proofRow(proofId)).screenshotBytes).toBeNull();
    });

    integrationTest("if Drive can't be read, viewing says so instead of failing silently", async () => {
        const { proofId } = await registerAndPay("down", PNG, "image/png");
        await archive.archivePendingScreenshots();
        drive.failures.nextDownload = new Error("network down");
        const response = await viewAs("organizer", proofId);
        expect(response.status).toBe(503);
        expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/Google Drive right now/);
    });

    integrationTest("organizers see where screenshots are", async () => {
        const status = await fetch(`${base}/admin/screenshot-storage`, { headers: { Authorization: `Bearer ${token("organizer")}` } });
        const data = ((await status.json()) as { data: { driveConnected: boolean; inDrive: number } }).data;
        expect(data.driveConnected).toBe(true);
        expect(data.inDrive).toBeGreaterThanOrEqual(5);
        expect((await fetch(`${base}/admin/screenshot-storage`, { headers: { Authorization: `Bearer ${token("stranger")}` } })).status).toBe(403);
    });

    integrationTest("without Drive connected nothing moves and screenshots stay in the database", async () => {
        setDriveClientForTests(null);
        const saved = { ...process.env };
        delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
        try {
            const { proofId } = await registerAndPay("nodrive", PNG, "image/png");
            expect(await archive.archivePendingScreenshots()).toEqual({ moved: 0, failed: [] });
            expect((await proofRow(proofId)).screenshotBytes?.length).toBe(PNG.length);
        } finally {
            process.env.GOOGLE_DRIVE_REFRESH_TOKEN = saved.GOOGLE_DRIVE_REFRESH_TOKEN;
            if (saved.GOOGLE_DRIVE_REFRESH_TOKEN === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
            setDriveClientForTests(drive.client);
        }
    });
});
