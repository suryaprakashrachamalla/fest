// Imports entrance scans made in the Luma check-in app, plus each member's Luma guest ID.
//   bun run luma:checkins
// Teams scanned at the entrance show as checked in on the admin dashboard and in Google Sheets.
import { prisma } from "./prisma.ts";
import { importLumaCheckIns, lumaEventIds } from "../LumaSyncService.ts";

async function main() {
    if (!process.env.LUMA_API_KEY?.trim()) throw new Error("LUMA_API_KEY is not set");
    if (lumaEventIds().size === 0) throw new Error("No Luma events mapped yet (set LUMA_EVENT_IDS)");
    for (const s of await importLumaCheckIns()) {
        if (s.error) {
            console.error(`${s.event}: failed: ${s.error}`);
            process.exitCode = 1;
            continue;
        }
        console.log(
            `${s.event}: ${s.lumaGuests} guest(s) in Luma, ${s.membersScanned} scanned at the entrance, ` +
                `${s.teamsEntered} team(s) newly checked in, ${s.guestIdsSaved} guest ID(s) saved`,
        );
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : "Luma check-in import failed");
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
