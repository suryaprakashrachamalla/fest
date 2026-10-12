import { prisma } from "./prisma.ts";
import { addOutbox } from "./outbox.ts";

// Events open for online registration. Slugs must match the website's event slugs.
// Re-running is safe: events are matched by slug and updated in place.
const events = [
    {
        name: "Hackathon",
        slug: "hackathon",
        description: "24-hour team hackathon. Domains: Cybersecurity, Defence, AI / ML, Autonomous Systems & Robotics.",
        feePaise: 39_900,
        feeMode: "PER_HEAD" as const,
        minTeamSize: 2,
        maxTeamSize: 3,
        isPublished: true,
    },
    {
        name: "NOCODE VIBEATHON",
        slug: "no-code-vibathon",
        description: "Build and ship an idea with no-code and AI tools.",
        // ₹300 per participant: 1 member pays ₹300, 2 members pay ₹600.
        feePaise: 30_000,
        feeMode: "PER_HEAD" as const,
        minTeamSize: 1,
        maxTeamSize: 2,
        isPublished: true,
    },
    {
        name: "GitHub Workshop",
        slug: "github-workshop",
        description: "Hands-on workshop on repositories, branches, pull requests and open-source collaboration.",
        feePaise: 15_000,
        feeMode: "PER_HEAD" as const,
        minTeamSize: 1,
        maxTeamSize: 1,
        isPublished: true,
    },
    {
        name: "Build Lab — Product Design Challenge",
        slug: "build-lab",
        description: "Product design challenge for teams of 2–3.",
        feePaise: 15_000,
        feeMode: "PER_HEAD" as const,
        minTeamSize: 2,
        maxTeamSize: 3,
        isPublished: true,
    },
    {
        name: "Standup Comedy",
        slug: "standup-comedy",
        description: "Telugu stand-up comedy night with Venkat Blaze.",
        feePaise: 29_900,
        feeMode: "FLAT" as const,
        minTeamSize: 1,
        maxTeamSize: 1,
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
