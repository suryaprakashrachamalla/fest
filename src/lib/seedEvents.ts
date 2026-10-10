import { prisma } from "./prisma.ts";
import { addOutbox } from "./outbox.ts";

// Events open for online registration. Slugs must match the website's event slugs.
// Re-running is safe: events are matched by slug and updated in place.
const events = [
    {
        name: "Hackathon",
        slug: "hackathon",
        description: "27-hour team hackathon. Domains: Cybersecurity, Defence, AI / ML, Autonomous Systems & Robotics.",
        feePaise: 39_900,
        feeMode: "PER_HEAD" as const,
        minTeamSize: 2,
        maxTeamSize: 3,
        isPublished: true,
    },
];

async function seedEvents() {
    for (const data of events) {
        await prisma.$transaction(async (tx) => {
            const event = await tx.event.upsert({
                where: { slug: data.slug },
                create: data,
                update: data,
            });
            await addOutbox(tx, "EVENT", event.id, {
                eventId: event.id,
                name: event.name,
                slug: event.slug,
                description: event.description ?? "",
                feePaise: event.feePaise,
                feeMode: event.feeMode,
                minTeamSize: event.minTeamSize,
                maxTeamSize: event.maxTeamSize,
                isPublished: event.isPublished,
                createdAt: event.createdAt.toISOString(),
                updatedAt: event.updatedAt.toISOString(),
            });
        });
    }
    console.log(`Seeded ${events.length} event(s): ${events.map((e) => e.slug).join(", ")}`);
}

seedEvents()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : "Event seeding failed");
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
