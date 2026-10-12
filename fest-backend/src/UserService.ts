import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "./lib/prisma.ts";
import { addOutbox } from "./lib/outbox.ts";

// Also called at startup so a missing or short secret stops the server instead of the first sign-in.
export function jwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32)
        throw new Error("JWT_SECRET must contain at least 32 characters");
    return secret;
}

export function safeUser(user: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

export async function signup(name: unknown, email: unknown, password: unknown) {
    if (
        typeof name !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string"
    )
        throw Object.assign(new Error("name, email, and password are required"), {
            status: 400,
        });
    const normalizedEmail = email.trim().toLowerCase();
    if (
        name.trim().length < 2 ||
        !/^\S+@\S+\.\S+$/.test(normalizedEmail) ||
        password.length < 10
    ) {
        throw Object.assign(
            new Error(
                "Provide a valid name, email, and password of at least 10 characters",
            ),
            { status: 400 },
        );
    }
    const passwordHash = await bcrypt.hash(password, 12);
    try {
        const user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    name: name.trim(),
                    email: normalizedEmail,
                    passwordHash,
                    role: "USER",
                },
            });
            await addOutbox(tx, "USER", created.id, {
                userId: created.id,
                name: created.name,
                email: created.email,
                role: created.role,
                createdAt: created.createdAt.toISOString(),
                updatedAt: created.updatedAt.toISOString(),
            });
            return created;
        });
        return safeUser(user);
    } catch (error) {
        if ((error as { code?: string }).code === "P2002")
            throw Object.assign(new Error("An account with this email already exists"), {
                status: 409,
            });
        throw error;
    }
}

export async function signin(email: unknown, password: unknown) {
    if (typeof email !== "string" || typeof password !== "string")
        throw Object.assign(new Error("email and password are required"), {
            status: 400,
        });
    const user = await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
        throw Object.assign(new Error("Invalid email or password"), { status: 401 });
    const token = jwt.sign({ sub: user.id }, jwtSecret(), {
        algorithm: "HS256",
        expiresIn: "12h",
        issuer: "fest-registration",
    });
    return { token, user: safeUser(user) };
}

export async function getUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
    return safeUser(user);
}

export function verifyToken(token: string): { sub: string } {
    return jwt.verify(token, jwtSecret(), { issuer: "fest-registration", algorithms: ["HS256"] }) as {
        sub: string;
    };
}
