import type { Prisma } from "../generated/prisma/client.ts";

export async function addOutbox(
    tx: Prisma.TransactionClient,
    entityType: "USER" | "EVENT" | "REGISTRATION" | "PARTICIPANT" | "PAYMENT_PROOF",
    entityId: string,
    payload: Prisma.InputJsonValue,
) {
    await tx.spreadsheetSyncOutbox.create({ data: { entityType, entityId, payload } });
}
