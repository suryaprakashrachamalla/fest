// Adds approved registrations to Luma so Luma emails each member their ticket.
//   bun run luma:sync           dry run: lists what would be sent, sends nothing
//   bun run luma:sync -- --send adds the guests to Luma (Luma sends the emails)
import { prisma } from "./prisma.ts";
import { lumaEventIds, syncApprovedToLuma } from "../LumaSyncService.ts";

const send = process.argv.includes("--send");

async function main() {
    const mapped = [...lumaEventIds()].map(([slug, id]) => `${slug} → ${id}`);
    console.log(mapped.length ? `Luma events: ${mapped.join(", ")}` : "No Luma events mapped yet (set LUMA_EVENT_IDS).");
    const results = await syncApprovedToLuma({ dryRun: !send, limit: 500 });
    if (results.length === 0) {
        console.log("No approved registrations are waiting for Luma.");
        return;
    }
    for (const r of results) {
        const target = r.lumaEventId ?? "no Luma event";
        console.log(`${r.outcome.padEnd(14)} ${r.code}  ${r.event} → ${target}  ${r.guests.join(", ")}${r.detail ? `  (${r.detail})` : ""}`);
    }
    if (!send) console.log("\nDry run only. Re-run with --send to add these guests to Luma.");
    if (results.some((r) => r.outcome === "failed")) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : "Luma sync failed");
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
