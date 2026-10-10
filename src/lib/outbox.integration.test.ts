// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { expect, test } from "bun:test";
import { prisma } from "./prisma.ts";
import { addOutbox } from "./outbox.ts";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? test : test.skip;

integrationTest("business changes and outbox entries commit atomically and pending jobs survive restart", async () => {
    const slug = `outbox-atomicity-${crypto.randomUUID()}`;
    let eventId = "";
    let outboxId = "";

    try {
        await expect(
            prisma.$transaction(async (tx) => {
                const event = await tx.event.create({
                    data: { name: "Outbox atomicity test", slug, feePaise: 0 },
                });
                eventId = event.id;
                const outbox = await tx.spreadsheetSyncOutbox.create({
                    data: {
                        entityType: "EVENT",
                        entityId: event.id,
                        payload: { eventId: event.id, name: event.name },
                    },
                });
                outboxId = outbox.id;
                throw new Error("force transaction rollback");
            }),
        ).rejects.toThrow("force transaction rollback");

        expect(await prisma.event.findUnique({ where: { slug } })).toBeNull();
        expect(await prisma.spreadsheetSyncOutbox.findUnique({ where: { id: outboxId } })).toBeNull();

        await prisma.$transaction(async (tx) => {
            const event = await tx.event.create({
                data: { name: "Outbox restart test", slug, feePaise: 0 },
            });
            eventId = event.id;
            await addOutbox(tx, "EVENT", event.id, {
                eventId: event.id,
                name: event.name,
            });
        });

        const pending = await prisma.spreadsheetSyncOutbox.findFirst({
            where: { entityType: "EVENT", entityId: eventId },
        });
        expect(pending?.status).toBe("PENDING");
        expect(pending?.nextAttemptAt).toBeInstanceOf(Date);
    } finally {
        if (eventId) {
            await prisma.spreadsheetSyncOutbox.deleteMany({
                where: { entityType: "EVENT", entityId: eventId },
            });
            await prisma.event.deleteMany({ where: { id: eventId } });
        }
        await prisma.$disconnect();
    }
});
