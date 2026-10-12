import app from "./app.ts";
import { prisma } from "./lib/prisma.ts";
import { startOutboxWorker } from "./ExcelSyncService.ts";
import { jwtSecret } from "./UserService.ts";
import * as luma from "./LumaSyncService.ts";
import * as tickets from "./TicketService.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");

// Fail fast on configuration that would otherwise only break the first sign-in.
jwtSecret();
if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
// A stray rejected promise is logged instead of taking the server down mid-event.
process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason instanceof Error ? reason.message : reason);
});

let stopWorker: (() => void) | undefined;
const stopLuma = luma.startLumaWorker();
const stopTickets = tickets.startTicketMailer();
const server = app.listen(port, host, () => {
    console.info(`Fest registration backend listening on ${host}:${port}`);
    void startOutboxWorker().then((stop) => {
        stopWorker = stop;
    });
});
async function shutdown() {
    stopWorker?.();
    stopLuma();
    stopTickets();
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
