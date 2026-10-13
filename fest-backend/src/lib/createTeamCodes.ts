// Creates team codes for one event and prints them, or lists an event's codes with --list.
//
//   bun src/lib/createTeamCodes.ts <event slug> <prefix> <how many> <rupees off>
//   bun src/lib/createTeamCodes.ts <event slug> --list
//
// e.g. "hackathon HK 10 50" makes 10 codes like HK-7KQ2M9XP, each taking Rs 50 off one
// registration for that event only. Each code works once (released if that registration is rejected).
import { randomInt } from "node:crypto";
import { prisma } from "./prisma.ts";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function newCode(prefix: string) {
    let suffix = "";
    for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
    return `${prefix}-${suffix}`;
}

async function main() {
    const [slug, second, countArg, rupeesArg] = process.argv.slice(2);
    const event = slug ? await prisma.event.findUnique({ where: { slug } }) : null;
    if (!event) throw new Error(`No event with the slug "${slug}"`);

    if (second === "--list") {
        const codes = await prisma.discountCode.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" } });
        const used = await prisma.registration.findMany({
            where: { id: { in: codes.map((c) => c.usedByRegistrationId).filter((id): id is string => Boolean(id)) } },
            select: { id: true, code: true },
        });
        console.log(`${event.name}: ${codes.length} team codes`);
        for (const c of codes) {
            const by = used.find((r) => r.id === c.usedByRegistrationId)?.code;
            console.log(`${c.code}  Rs ${c.amountPaise / 100} off  ${by ? `used by ${by}` : "unused"}`);
        }
        return;
    }

    const prefix = (second ?? "").toUpperCase();
    const count = Number(countArg);
    const rupees = Number(rupeesArg);
    if (!/^[A-Z]{2}$/.test(prefix)) throw new Error("The prefix must be 2 letters, e.g. HK");
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("How many must be between 1 and 200");
    if (!Number.isInteger(rupees) || rupees < 1 || rupees * 100 > event.feePaise * 10) throw new Error("Give the discount in whole rupees");

    const codes = new Set<string>();
    while (codes.size < count) codes.add(newCode(prefix));
    const created = await prisma.discountCode.createMany({
        data: [...codes].map((code) => ({ code, eventId: event.id, amountPaise: rupees * 100 })),
        skipDuplicates: true,
    });
    const saved = await prisma.discountCode.findMany({ where: { code: { in: [...codes] } }, select: { code: true } });
    console.log(`${event.name}: created ${created.count} team codes, Rs ${rupees} off each (one registration per code):`);
    for (const { code } of saved) console.log(code);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
