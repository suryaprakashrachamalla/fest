import { prisma } from "./lib/prisma.ts";
import { driveConfigured, uploadScreenshot } from "./lib/driveStorage.ts";

// Moves payment screenshots from the database to Google Drive in the background. A screenshot is
// saved in the database first (so uploads are instant and never lost), copied to Drive, and only
// removed from the database once Drive has a copy of the same size. A failed copy stays in the
// database and is tried again after CLAIM_TIMEOUT_MS.
const CLAIM_TIMEOUT_MS = 5 * 60_000;

function extension(mimeType: string) {
    return mimeType === "image/png" ? "png" : "jpg";
}

// "SG26-3H8945J2_UTR123.jpg"; characters Drive file names don't like are dropped.
function fileName(code: string, utr: string, mimeType: string) {
    return `${code}_${utr}`.replace(/[^A-Za-z0-9._-]/g, "") + `.${extension(mimeType)}`;
}

export async function archivePendingScreenshots({ limit = 20 }: { limit?: number } = {}) {
    const result = { moved: 0, failed: [] as { proofId: string; error: string }[] };
    if (!driveConfigured()) return result;
    const stale = () => new Date(Date.now() - CLAIM_TIMEOUT_MS);
    const pending = await prisma.paymentProof.findMany({
        where: {
            driveFileId: null,
            screenshotBytes: { not: null },
            OR: [{ driveAttemptAt: null }, { driveAttemptAt: { lt: stale() } }],
        },
        select: { id: true },
        orderBy: { submittedAt: "asc" },
        take: limit,
    });
    for (const { id } of pending) {
        // Claim it, so two servers (side by side during a deploy) don't copy the same screenshot.
        const claimed = await prisma.paymentProof.updateMany({
            where: { id, driveFileId: null, OR: [{ driveAttemptAt: null }, { driveAttemptAt: { lt: stale() } }] },
            data: { driveAttemptAt: new Date() },
        });
        if (claimed.count !== 1) continue;
        const proof = await prisma.paymentProof.findUniqueOrThrow({
            where: { id },
            select: {
                utr: true,
                screenshotBytes: true,
                screenshotMimeType: true,
                registration: { select: { code: true, event: { select: { name: true } } } },
            },
        });
        if (!proof.screenshotBytes) continue;
        try {
            const driveFileId = await uploadScreenshot({
                proofId: id,
                eventName: proof.registration.event.name,
                fileName: fileName(proof.registration.code, proof.utr, proof.screenshotMimeType),
                mimeType: proof.screenshotMimeType,
                bytes: proof.screenshotBytes,
            });
            await prisma.paymentProof.updateMany({
                where: { id, driveFileId: null },
                data: { driveFileId, driveUploadedAt: new Date(), driveError: null, screenshotBytes: null },
            });
            result.moved++;
        } catch (error) {
            const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
            await prisma.paymentProof.update({ where: { id }, data: { driveError: message } });
            result.failed.push({ proofId: id, error: message });
        }
    }
    return result;
}

let runNow: (() => Promise<void>) | undefined;

// Copies screenshots on an interval once Drive is connected. Returns a stop function.
export function startScreenshotArchiver() {
    if (!driveConfigured()) {
        console.warn("Google Drive isn't connected (GOOGLE_DRIVE_REFRESH_TOKEN): payment screenshots stay in the database.");
        return () => {};
    }
    const interval = Math.max(30_000, Number(process.env.SCREENSHOT_ARCHIVE_INTERVAL_MS) || 120_000);
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await archivePendingScreenshots();
            if (result.moved) console.info(`Screenshots: copied ${result.moved} to Google Drive`);
            for (const failure of result.failed) console.error(`Screenshots: copying ${failure.proofId} to Google Drive failed: ${failure.error}`);
        } catch (error) {
            console.error("Screenshot copy to Google Drive failed:", error instanceof Error ? error.message : error);
        } finally {
            running = false;
        }
    };
    runNow = tick;
    const timer = setInterval(() => void tick(), interval);
    void tick();
    console.info(`Payment screenshots go to Google Drive (every ${Math.round(interval / 1000)}s)`);
    return () => {
        clearInterval(timer);
        runNow = undefined;
    };
}

// Lets a new upload be copied soon instead of waiting for the next tick.
export function archiveScreenshotsSoon() {
    const tick = runNow;
    if (tick) setTimeout(() => void tick(), 5_000);
}

export async function screenshotStorageStatus() {
    const [inDrive, waiting, failed] = await Promise.all([
        prisma.paymentProof.count({ where: { driveFileId: { not: null } } }),
        prisma.paymentProof.count({ where: { driveFileId: null, screenshotBytes: { not: null } } }),
        prisma.paymentProof.count({ where: { driveFileId: null, driveError: { not: null } } }),
    ]);
    return { driveConnected: driveConfigured(), inDrive, inDatabase: waiting, failed };
}
