// The HTTP API. index.ts starts it with the background workers; tests mount it on a random port.
import express, { type RequestHandler } from "express";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, optionalAuthenticate } from "./middleware/authenticate.ts";
import { requireAdmin } from "./middleware/requireAdmin.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { prisma } from "./lib/prisma.ts";
import * as users from "./UserService.ts";
import * as events from "./EventsService.ts";
import * as registrations from "./RegistrationsService.ts";
import * as payments from "./PaymentVerificationService.ts";
import * as paymentQr from "./PaymentQrService.ts";
import * as checkIn from "./CheckInService.ts";
import { reconcileSpreadsheet, getSyncStatus } from "./ExcelSyncService.ts";
import * as luma from "./LumaSyncService.ts";
import * as tickets from "./TicketService.ts";
import * as analytics from "./OverviewService.ts";
import { requireEventViewer, requireSuperAdmin } from "./OverviewService.ts";
import { archiveScreenshotsSoon, screenshotStorageStatus } from "./ScreenshotArchiveService.ts";

const app = express();
const directory = path.dirname(fileURLToPath(import.meta.url));
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
app.disable("x-powered-by");
const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy) {
    app.set(
        "trust proxy",
        /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === "true" ? 1 : trustProxy,
    );
}
app.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false,
    }),
);
app.use(express.json({ limit: "100kb" }));
app.use((req, _res, next) => {
    console.info(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});
app.use(
    express.static(path.resolve(directory, "../public"), {
        index: false,
        dotfiles: "deny",
    }),
);

function limited(message: string) {
    return { success: false, error: { code: "RATE_LIMITED", message } };
}
// Sign-in and sign-up attempts are limited per account (IP + email) to stop password guessing.
// A per-IP limit alone would lock out a whole campus: every student on the college Wi-Fi shares
// one public IP. A much higher per-IP ceiling still stops one machine from spraying accounts.
const authAccountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254)}`,
    message: limited("Too many attempts for this account. Try again in 15 minutes."),
});
const authIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Math.max(10, Number(process.env.AUTH_IP_LIMIT) || 300),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: limited("Too many authentication attempts from this network. Try again later."),
});
const authLimiter: RequestHandler = (req, res, next) =>
    authIpLimiter(req, res, (error?: unknown) => (error ? next(error) : authAccountLimiter(req, res, next)));
// Organizer lookups and entry authorizations, per signed-in organizer: generous for a busy gate,
// but enough to stop a stolen session from walking through registration IDs.
const adminActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
    message: limited("Too many lookups in a minute. Wait a moment and try again."),
});
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) =>
        callback(null, ["image/png", "image/jpeg"].includes(file.mimetype)),
});
const ok = (
    res: express.Response,
    data: unknown,
    message = "Operation completed successfully",
    status = 200,
) => res.status(status).json({ success: true, data, message });
const admin: RequestHandler[] = [authenticate, requireAdmin];
// Team-code checks from the registration form, per account: enough for typos, too few to guess codes.
const teamCodeLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
    message: limited("Too many team code attempts. Try again in a few minutes."),
});
// Entrance lookups and check-ins, rate limited per organizer.
const gate: RequestHandler[] = [...admin, adminActionLimiter];

app.post("/auth/signup", authLimiter, async (req, res) =>
    ok(
        res,
        await users.signup(req.body?.name, req.body?.email, req.body?.password),
        "Account created",
        201,
    ),
);
app.post("/auth/signin", authLimiter, async (req, res) =>
    ok(res, await users.signin(req.body?.email, req.body?.password), "Signed in"),
);
app.get("/auth/me", authenticate, async (req, res) =>
    ok(res, await users.getUser(req.user!.id)),
);

app.get("/events", async (_req, res) => ok(res, await events.listEvents()));
app.get("/payment-qr/active", async (_req, res) => ok(res, await paymentQr.getActiveQr()));
app.get("/payment-qr/active/image", async (_req, res) => {
    const image = await paymentQr.getActiveQrImage();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(image.mimeType).send(image.imageBytes);
});
app.get("/events/:eventId", optionalAuthenticate, async (req, res) =>
    ok(
        res,
        await events.getEvent(
            String(String(req.params.eventId)),
            req.user?.role === "ADMIN",
        ),
    ),
);
app.post("/admin/events", admin, async (req: express.Request, res: express.Response) =>
    ok(res, await events.createEvent(req.body ?? {}), "Event created", 201),
);
app.patch(
    "/admin/events/:eventId",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await events.updateEvent(String(req.params.eventId), req.body ?? {}),
            "Event updated",
        ),
);

app.post("/events/:eventId/registrations", authenticate, async (req, res) =>
    ok(
        res,
        await registrations.createRegistration(
            req.user!.id,
            String(String(req.params.eventId)),
            req.body ?? {},
        ),
        "Registration created",
        201,
    ),
);
// Checks a team code for this event before registering (the registration itself checks it again).
app.post("/events/:eventId/team-code", authenticate, teamCodeLimiter, async (req, res) =>
    ok(res, await registrations.checkTeamCode(String(req.params.eventId), req.body?.code), "Team code applied"),
);
app.get("/registrations/me", authenticate, async (req, res) =>
    ok(res, await registrations.getMyRegistrations(req.user!.id)),
);
app.get("/registrations/:registrationId", authenticate, async (req, res) =>
    ok(
        res,
        await registrations.getRegistration(
            String(req.params.registrationId),
            req.user!.id,
            req.user!.role === "ADMIN",
        ),
    ),
);

app.post(
    "/registrations/:registrationId/payment-proofs",
    authenticate,
    upload.single("screenshot"),
    async (req, res) => {
        const proof = await payments.submitProof(
            String(req.params.registrationId),
            req.user!.id,
            req.body?.utr,
            req.file,
            req.body?.paymentMethod,
        );
        archiveScreenshotsSoon();
        ok(res, proof, "Payment proof submitted", 201);
    },
);
app.get("/registrations/:registrationId/payment-proofs", authenticate, async (req, res) =>
    ok(
        res,
        await payments.listRegistrationProofs(
            String(req.params.registrationId),
            req.user!.id,
            req.user!.role === "ADMIN",
        ),
    ),
);
app.get(
    "/registrations/:registrationId/payment-proofs/:proofId/screenshot",
    authenticate,
    async (req, res) => {
        const image = await payments.getScreenshot(
            String(req.params.proofId),
            req.user!.id,
            req.user!.role === "ADMIN",
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.type(image.mimeType).send(image.bytes);
    },
);
// A team member's entry QR, shown on the team's dashboard once the registration is approved.
app.get(
    "/registrations/:registrationId/participants/:participantId/ticket",
    authenticate,
    async (req, res) => {
        const png = await tickets.ticketImage(
            String(req.params.registrationId),
            String(req.params.participantId),
            req.user!.id,
            req.user!.role === "ADMIN",
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store");
        res.type("image/png").send(png);
    },
);

app.get(
    "/admin/payment-qrs",
    admin,
    async (_req: express.Request, res: express.Response) =>
        ok(res, await paymentQr.listQrCodes()),
);
app.post(
    "/admin/payment-qrs",
    admin,
    upload.single("image"),
    async (req: express.Request, res: express.Response) =>
        ok(res, await paymentQr.createQrCode(req.body?.label, req.file), "QR code added", 201),
);
app.get(
    "/admin/payment-qrs/:qrId/image",
    admin,
    async (req: express.Request, res: express.Response) => {
        const image = await paymentQr.getQrImage(String(req.params.qrId));
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store");
        res.type(image.mimeType).send(image.imageBytes);
    },
);
app.patch(
    "/admin/payment-qrs/:qrId/active",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await paymentQr.setQrActive(String(req.params.qrId), req.body?.isActive),
            "QR code status updated",
        ),
);
app.get(
    "/admin/registrations",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(res, await registrations.listAdminRegistrations(req.query.status)),
);
app.get(
    "/admin/registrations/pending",
    admin,
    async (_req: express.Request, res: express.Response) =>
        ok(res, await payments.listPending()),
);
app.get(
    "/admin/registrations/:registrationId",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await registrations.getRegistration(
                String(req.params.registrationId),
                req.user!.id,
                true,
            ),
        ),
);
app.get(
    "/admin/registrations/:registrationId/audit",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(res, await registrations.getAuditHistory(String(req.params.registrationId))),
);
app.patch(
    "/admin/registrations/:registrationId/approve",
    admin,
    async (req: express.Request, res: express.Response) => {
        // Verifies a pending payment proof first, so one Approve click covers both steps.
        const result = await registrations.approveWithPayment(
            String(req.params.registrationId),
            req.user!.id,
        );
        if (!result.alreadyApproved) {
            tickets.sendTicketsSoon();
            luma.syncSoon();
        }
        ok(res, result, result.alreadyApproved ? "Registration was already approved" : "Registration approved");
    },
);
app.patch(
    "/admin/registrations/:registrationId/reject",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await registrations.rejectRegistration(
                String(req.params.registrationId),
                req.user!.id,
                req.body?.reason,
            ),
            "Registration rejected",
        ),
);
app.get(
    "/admin/payment-proofs/:proofId",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(res, await payments.getAdminProof(String(req.params.proofId))),
);
app.get(
    "/admin/payment-proofs/:proofId/screenshot",
    admin,
    async (req: express.Request, res: express.Response) => {
        const image = await payments.getScreenshot(
            String(req.params.proofId),
            req.user!.id,
            true,
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.type(image.mimeType).send(image.bytes);
    },
);
app.patch(
    "/admin/payment-proofs/:proofId/verify",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await payments.reviewProof(
                String(req.params.proofId),
                req.user!.id,
                "verify",
            ),
            "Payment verified",
        ),
);
app.patch(
    "/admin/payment-proofs/:proofId/reject",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await payments.reviewProof(
                String(req.params.proofId),
                req.user!.id,
                "reject",
                req.body?.reason,
            ),
            "Payment proof rejected",
        ),
);

app.get(
    "/admin/registrations/:registrationId/check-in-status",
    admin,
    async (req: express.Request, res: express.Response) =>
        ok(res, await checkIn.checkInStatus(String(req.params.registrationId))),
);
app.post(
    "/admin/check-in",
    admin,
    async (req: express.Request, res: express.Response) => {
        if (typeof req.body?.registrationId !== "string")
            throw Object.assign(new Error("registrationId is required"), { status: 400 });
        return ok(
            res,
            await checkIn.checkIn(req.body.registrationId, req.user!.id),
            "Team checked in",
        );
    },
);

// Entrance: look up a scanned entry QR, then mark that member as entered (one band each).
app.post(
    "/admin/tickets/scan",
    gate,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            // admit=true records the entry on a valid ticket's first scan; scanId makes retries safe.
            await tickets.scanTicket(
                req.body?.code,
                req.body?.admit === true ? req.user!.id : undefined,
                typeof req.body?.scanId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(req.body.scanId) ? req.body.scanId : undefined,
            ),
            "Ticket found",
        ),
);
app.post(
    "/admin/tickets/:participantId/check-in",
    gate,
    async (req: express.Request, res: express.Response) =>
        ok(res, await tickets.admitParticipant(String(req.params.participantId), req.user!.id), "Entry recorded"),
);
// Entrance fallback: find a team by its registration ID, then check in the chosen members.
app.post(
    "/admin/tickets/team",
    gate,
    async (req: express.Request, res: express.Response) => ok(res, await tickets.lookupTeam(req.body?.code), "Team found"),
);
app.post(
    "/admin/registrations/:registrationId/check-in-members",
    gate,
    async (req: express.Request, res: express.Response) =>
        ok(
            res,
            await tickets.checkInMembers(String(req.params.registrationId), req.body?.participantIds, req.user!.id, req.body?.requestId),
            "Entry recorded",
        ),
);
// Where payment screenshots are: copied to Google Drive, or still waiting in the database.
app.get("/admin/screenshot-storage", admin, async (_req: express.Request, res: express.Response) =>
    ok(res, await screenshotStorageStatus()),
);
app.get(
    "/admin/tickets/mail-status",
    admin,
    async (_req: express.Request, res: express.Response) => ok(res, await tickets.ticketMailStatus()),
);
app.post(
    "/admin/registrations/:registrationId/resend-tickets",
    admin,
    async (req: express.Request, res: express.Response) => {
        const result = await tickets.resendTickets(
            String(req.params.registrationId),
            req.user!.id,
            req.body?.participantId,
        );
        tickets.sendTicketsSoon();
        ok(res, result, "Ticket email queued");
    },
);

// Super-admin analytics, read from each event's tab in the Google Sheet. Test data (excluded by the
// super admins' rules) is reported separately from the production numbers and never deleted.
const superAdmin: RequestHandler[] = [...admin, requireSuperAdmin, adminActionLimiter];
app.get("/admin/overview", superAdmin, async (req: express.Request, res: express.Response) =>
    ok(res, await analytics.eventOverview({ refresh: req.query.refresh === "true" })),
);
app.get("/admin/analytics/records", superAdmin, async (req: express.Request, res: express.Response) =>
    ok(res, await analytics.analyticsRecords(req.query as Record<string, unknown>)),
);
app.get("/admin/analytics/records.csv", superAdmin, async (req: express.Request, res: express.Response) => {
    const csv = await analytics.analyticsCsv(req.query as Record<string, unknown>);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", 'attachment; filename="shourya26-registrations.csv"');
    res.type("text/csv").send(csv);
});
app.get("/admin/analytics/exclusions", superAdmin, async (_req: express.Request, res: express.Response) =>
    ok(res, await analytics.listExclusions()),
);
app.post("/admin/analytics/exclusions", superAdmin, async (req: express.Request, res: express.Response) =>
    ok(res, await analytics.addExclusion(req.user!.id, req.body ?? {}), "Excluded from analytics", 201),
);
app.delete("/admin/analytics/exclusions/:exclusionId", superAdmin, async (req: express.Request, res: express.Response) =>
    ok(res, await analytics.removeExclusion(String(req.params.exclusionId)), "Exclusion removed"),
);
// Event analytics viewers (normal accounts granted some events): the same analytics, read-only and
// limited on the server to their events. No organizer routes, settings or other events.
const eventViewer: RequestHandler[] = [authenticate, requireEventViewer, adminActionLimiter];
// Which events this account may see (for the dashboard link); 403 for everyone else.
app.get("/event-analytics/access", eventViewer, async (_req: express.Request, res: express.Response) =>
    ok(res, await prisma.event.findMany({ where: { id: { in: res.locals.eventIds } }, select: { id: true, name: true } })),
);
app.get("/event-analytics/overview", eventViewer, async (req: express.Request, res: express.Response) =>
    ok(res, await analytics.eventOverview({ refresh: req.query.refresh === "true", eventIds: res.locals.eventIds })),
);
app.get("/event-analytics/records", eventViewer, async (req: express.Request, res: express.Response) =>
    ok(res, await analytics.analyticsRecords(req.query as Record<string, unknown>, res.locals.eventIds)),
);
app.get("/event-analytics/records.csv", eventViewer, async (req: express.Request, res: express.Response) => {
    const csv = await analytics.analyticsCsv(req.query as Record<string, unknown>, res.locals.eventIds);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", 'attachment; filename="shourya26-event-registrations.csv"');
    res.type("text/csv").send(csv);
});
app.get("/admin/analytics/suggestions", superAdmin, async (_req: express.Request, res: express.Response) =>
    ok(res, await analytics.exclusionSuggestions()),
);

app.get("/health", (_req, res) => ok(res, { status: "ok" }, "Service is healthy"));
// Readiness: also checks the database answers (the load balancer keeps using /health, so a
// database blip doesn't get healthy containers replaced).
app.get("/health/ready", async (_req, res) => {
    try {
        await Promise.race([
            prisma.$queryRaw`SELECT 1`,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
        ]);
        ok(res, { status: "ok", database: "ok" }, "Service is ready");
    } catch {
        res.status(503).json({ success: false, error: { code: "NOT_READY", message: "Database unavailable" } });
    }
});
app.get(
    "/admin/sync-status",
    admin,
    async (_req: express.Request, res: express.Response) =>
        ok(res, await getSyncStatus()),
);
// Sends approved registrations to Luma now (Luma emails the tickets); dryRun=true only previews.
app.post(
    "/admin/luma-sync",
    admin,
    async (req: express.Request, res: express.Response) => {
        if (!luma.lumaConfigured())
            throw Object.assign(new Error("Luma isn't configured: set LUMA_API_KEY and LUMA_EVENT_IDS"), { status: 409 });
        const dryRun = req.query.dryRun === "true";
        ok(res, await luma.syncApprovedToLuma({ dryRun }), dryRun ? "Luma preview" : "Luma sync completed");
    },
);
// Imports entrance scans made in the Luma check-in app.
app.post(
    "/admin/luma-checkins",
    admin,
    async (_req: express.Request, res: express.Response) => {
        if (!luma.lumaConfigured())
            throw Object.assign(new Error("Luma isn't configured: set LUMA_API_KEY and LUMA_EVENT_IDS"), { status: 409 });
        ok(res, await luma.importLumaCheckIns(), "Luma check-ins imported");
    },
);
app.post(
    "/admin/sync-reconcile",
    admin,
    async (_req: express.Request, res: express.Response) => {
        ok(res, await reconcileSpreadsheet(true), "Reconciliation completed");
    },
);
app.use((_req, res) =>
    res
        .status(404)
        .json({
            success: false,
            error: { code: "NOT_FOUND", message: "Route not found" },
        }),
);
app.use(errorHandler);

export default app;
