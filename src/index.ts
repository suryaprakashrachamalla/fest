import express, { type RequestHandler } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
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
import {
    reconcileSpreadsheet,
    getSyncStatus,
    startOutboxWorker,
} from "./ExcelSyncService.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");
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
        methods: ["GET", "POST", "PATCH"],
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

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: "RATE_LIMITED",
            message: "Too many authentication attempts. Try again later.",
        },
    },
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
            req.body?.teamName,
            req.body?.participants,
        ),
        "Registration created",
        201,
    ),
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
    async (req, res) =>
        ok(
            res,
            await payments.submitProof(
                String(req.params.registrationId),
                req.user!.id,
                req.body?.utr,
                req.file,
            ),
            "Payment proof submitted",
            201,
        ),
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
    async (_req: express.Request, res: express.Response) =>
        ok(res, await registrations.listAdminRegistrations()),
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

app.get("/health", (_req, res) => ok(res, { status: "ok" }, "Service is healthy"));
app.get(
    "/admin/sync-status",
    admin,
    async (_req: express.Request, res: express.Response) =>
        ok(res, await getSyncStatus()),
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

let stopWorker: (() => void) | undefined;
const server = app.listen(port, host, () => {
    console.info(`Fest registration backend listening on ${host}:${port}`);
    void startOutboxWorker().then((stop) => {
        stopWorker = stop;
    });
});
async function shutdown() {
    stopWorker?.();
    server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => {
    void shutdown();
});
process.on("SIGTERM", () => {
    void shutdown();
});
