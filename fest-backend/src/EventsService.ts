import { prisma } from "./lib/prisma.ts";
import { addOutbox } from "./lib/outbox.ts";

function validateEvent(data: Record<string, unknown>, partial = false) {
    if (!partial && (typeof data.name !== "string" || typeof data.slug !== "string"))
        throw Object.assign(new Error("name and slug are required"), { status: 400 });
    if (
        data.name !== undefined &&
        (typeof data.name !== "string" || data.name.trim().length < 2)
    )
        throw Object.assign(
            new Error("Event name must contain at least two characters"),
            { status: 400 },
        );
    if (
        data.slug !== undefined &&
        (typeof data.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug))
    )
        throw Object.assign(
            new Error("slug must contain lowercase letters, numbers, and hyphens"),
            { status: 400 },
        );
    if (
        data.feePaise !== undefined &&
        (!Number.isInteger(data.feePaise) || Number(data.feePaise) < 0)
    )
        throw Object.assign(new Error("feePaise must be a non-negative integer"), {
            status: 400,
        });
    if (
        data.minTeamSize !== undefined &&
        (!Number.isInteger(data.minTeamSize) ||
            Number(data.minTeamSize) < 1 ||
            Number(data.minTeamSize) > 4)
    )
        throw Object.assign(new Error("minTeamSize must be between 1 and 4"), {
            status: 400,
        });
    if (
        data.maxTeamSize !== undefined &&
        (!Number.isInteger(data.maxTeamSize) ||
            Number(data.maxTeamSize) < 1 ||
            Number(data.maxTeamSize) > 4)
    )
        throw Object.assign(new Error("maxTeamSize must be between 1 and 4"), {
            status: 400,
        });
    const min = Number(data.minTeamSize ?? 1),
        max = Number(data.maxTeamSize ?? 4);
    if (min > max)
        throw Object.assign(new Error("minTeamSize cannot exceed maxTeamSize"), {
            status: 400,
        });
    if (data.feeMode !== undefined && data.feeMode !== "FLAT" && data.feeMode !== "PER_HEAD")
        throw Object.assign(new Error("feeMode must be FLAT or PER_HEAD"), { status: 400 });
    for (const key of ["isPublished"])
        if (data[key] !== undefined && typeof data[key] !== "boolean")
            throw Object.assign(new Error(`${key} must be a boolean`), { status: 400 });
    if (
        data.description !== undefined &&
        data.description !== null &&
        typeof data.description !== "string"
    )
        throw Object.assign(new Error("description must be a string or null"), {
            status: 400,
        });
}

function row(event: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    feePaise: number;
    feeMode: string;
    minTeamSize: number;
    maxTeamSize: number;
    feeTiers?: unknown;
    isPublished: boolean;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        eventId: event.id,
        name: event.name,
        slug: event.slug,
        description: event.description,
        feePaise: event.feePaise,
        feeMode: event.feeMode,
        minTeamSize: event.minTeamSize,
        maxTeamSize: event.maxTeamSize,
        feeTiers: event.feeTiers ?? null,
        isPublished: event.isPublished,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
    };
}

export async function listEvents() {
    return prisma.event.findMany({
        where: { isPublished: true },
        orderBy: { createdAt: "desc" },
    });
}
export async function getEvent(id: string, isAdmin: boolean) {
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event || (!event.isPublished && !isAdmin))
        throw Object.assign(new Error("Event not found"), { status: 404 });
    return event;
}
export async function createEvent(body: Record<string, unknown>) {
    validateEvent(body);
    try {
        return await prisma.$transaction(async (tx) => {
            const created = await tx.event.create({
                data: {
                    name: String(body.name).trim(),
                    slug: String(body.slug),
                    description: body.description as string | null | undefined,
                    feePaise: Number(body.feePaise ?? 0),
                    feeMode: body.feeMode === "PER_HEAD" ? "PER_HEAD" : "FLAT",
                    minTeamSize: Number(body.minTeamSize ?? 1),
                    maxTeamSize: Number(body.maxTeamSize ?? 4),
                    isPublished: Boolean(body.isPublished ?? false),
                },
            });
            await addOutbox(tx, "EVENT", created.id, row(created));
            return created;
        });
    } catch (error) {
        if ((error as { code?: string }).code === "P2002")
            throw Object.assign(new Error("Event slug already exists"), { status: 409 });
        throw error;
    }
}
export async function updateEvent(id: string, body: Record<string, unknown>) {
    validateEvent(body, true);
    if (
        Object.keys(body).some(
            (key) =>
                ![
                    "name",
                    "slug",
                    "description",
                    "feePaise",
                    "feeMode",
                    "minTeamSize",
                    "maxTeamSize",
                    "isPublished",
                ].includes(key),
        )
    )
        throw Object.assign(new Error("Unsupported event field"), { status: 400 });
    try {
        return await prisma.$transaction(async (tx) => {
            const event = await tx.event.update({
                where: { id },
                data: {
                    ...body,
                    name: typeof body.name === "string" ? body.name.trim() : undefined,
                },
            });
            await addOutbox(tx, "EVENT", event.id, row(event));
            return event;
        });
    } catch (error) {
        if ((error as { code?: string }).code === "P2025")
            throw Object.assign(new Error("Event not found"), { status: 404 });
        if ((error as { code?: string }).code === "P2002")
            throw Object.assign(new Error("Event slug already exists"), { status: 409 });
        throw error;
    }
}
