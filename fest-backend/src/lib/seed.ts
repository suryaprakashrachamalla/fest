import bcrypt from "bcrypt";
import { prisma } from "./prisma.ts";

const admins = [
    {
        username: "adminSuper",
        name: "ADMIN_SUPER_NAME",
        email: "ADMIN_SUPER_EMAIL",
        password: "ADMIN_SUPER_PASSWORD",
    },
    {
        username: "adminVolunteer1",
        name: "ADMIN_VOLUNTEER1_NAME",
        email: "ADMIN_VOLUNTEER1_EMAIL",
        password: "ADMIN_VOLUNTEER1_PASSWORD",
    },
    {
        username: "adminVolunteer2",
        name: "ADMIN_VOLUNTEER2_NAME",
        email: "ADMIN_VOLUNTEER2_EMAIL",
        password: "ADMIN_VOLUNTEER2_PASSWORD",
    },
];

async function seed() {
    const configured = admins.map((admin) => ({
        ...admin,
        configuredName: process.env[admin.name]?.trim(),
        configuredEmail: process.env[admin.email]?.trim().toLowerCase(),
        configuredPassword: process.env[admin.password],
    }));
    if (
        configured.some(
            (admin) =>
                !admin.configuredName ||
                !admin.configuredEmail ||
                !admin.configuredPassword,
        )
    ) {
        throw new Error(
            "Missing required administrator name, email, or password environment variables",
        );
    }
    const emails = configured.map((admin) => admin.configuredEmail!);
    const passwords = configured.map((admin) => admin.configuredPassword!);
    if (new Set(emails).size !== 3)
        throw new Error("Each administrator must have a different email address");
    if (new Set(passwords).size !== 3)
        throw new Error("Each administrator must have a unique password");
    for (const admin of admins) {
        const settings = configured.find((item) => item.username === admin.username)!;
        const name = settings.configuredName!;
        const email = settings.configuredEmail!;
        const password = settings.configuredPassword!;
        if (
            password.length < 16 ||
            (process.env.NODE_ENV === "production" &&
                (password.length < 24 || password.startsWith("DonaldTrump!")))
        )
            throw new Error(
                `${admin.password} must be replaced with a strong production password`,
            );
        const passwordHash = await bcrypt.hash(password, 12);
        await prisma.user.upsert({
            where: { email },
            create: { name, email, passwordHash, role: "ADMIN" },
            update: { name, passwordHash, role: "ADMIN" },
        });
    }
    console.log("Seeded the three configured administrator accounts.");
}

seed()
    .catch((error) => {
        console.error(
            error instanceof Error ? error.message : "Administrator seeding failed",
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
