// Gives a normal account read-only analytics for some events (or lists / removes it).
//
//   bun src/lib/grantEventAnalytics.ts <email> <event slug> [<event slug> ...]
//   bun src/lib/grantEventAnalytics.ts <email> --list
//   bun src/lib/grantEventAnalytics.ts <email> --revoke
//
// Organizer (ADMIN) accounts are refused: they already see the organizer panel.
import { prisma } from "./prisma.ts";

async function main() {
    const [emailArg, ...rest] = process.argv.slice(2);
    const email = (emailArg ?? "").trim().toLowerCase();
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!user) throw new Error(`No account signs in with "${email}" (sign up on the site first)`);
    if (user.role === "ADMIN") throw new Error("That's an organizer account; event analytics are for normal accounts");
    if (rest[0] === "--revoke") {
        const removed = await prisma.eventAnalyticsAccess.deleteMany({ where: { userId: user.id } });
        console.log(`Removed ${removed.count} event(s) from ${email}`);
        return;
    }
    if (rest[0] !== "--list") {
        if (!rest.length) throw new Error("Name at least one event slug");
        const events = await prisma.event.findMany({ where: { slug: { in: rest } } });
        const unknown = rest.filter((slug) => !events.some((e) => e.slug === slug));
        if (unknown.length) throw new Error(`Unknown event slug(s): ${unknown.join(", ")}`);
        await prisma.eventAnalyticsAccess.createMany({
            data: events.map((e) => ({ userId: user.id, eventId: e.id })),
            skipDuplicates: true,
        });
    }
    const grants = await prisma.eventAnalyticsAccess.findMany({ where: { userId: user.id }, include: { event: { select: { name: true } } } });
    console.log(`${email} (${user.role}) can see analytics for: ${grants.map((g) => g.event.name).join(", ") || "nothing"}`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
