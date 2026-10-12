import bcrypt from "bcrypt";
import { prisma } from "./prisma.ts";

// Each admin's name, email and password come from ADMIN_<KEY>_NAME/_EMAIL/_PASSWORD, e.g.
// ADMIN_SUPER2_EMAIL or ADMIN_VOLUNTEER7_PASSWORD. Every admin has the same permissions.
const VOLUNTEER_COUNT = 10;
const admins = ["SUPER", "SUPER2", "SUPER3", ...Array.from({ length: VOLUNTEER_COUNT }, (_, i) => `VOLUNTEER${i + 1}`)].map(
    (key) => ({
        username: `admin${key[0]}${key.slice(1).toLowerCase()}`,
        name: `ADMIN_${key}_NAME`,
        email: `ADMIN_${key}_EMAIL`,
        password: `ADMIN_${key}_PASSWORD`,
    }),
);

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
    if (new Set(emails).size !== admins.length)
        throw new Error("Each administrator must have a different email address");
    if (new Set(passwords).size !== admins.length)
        throw new Error("Each administrator must have a unique password");
    for (const admin of admins) {
        const settings = configured.find((item) => item.username === admin.username)!;
        const name = settings.configuredName!;
        const email = settings.configuredEmail!;
        const password = settings.configuredPassword!;
        // The organizers chose short admin passwords; 10 characters is the floor, and the
        // .env.example placeholders are never accepted in production.
        if (
            password.length < 10 ||
            (process.env.NODE_ENV === "production" &&
                (password.startsWith("DonaldTrump!") || password.startsWith("replace-with-")))
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
    // Only the configured accounts may be admins; a replaced admin email keeps its
    // account and history but loses organizer access.
    const demoted = await prisma.user.updateMany({
        where: { role: "ADMIN", email: { notIn: emails } },
        data: { role: "USER" },
    });
    console.log(`Seeded the ${admins.length} configured administrator accounts.`);
    if (demoted.count > 0)
        console.log(`Removed admin access from ${demoted.count} account(s) no longer configured as admins.`);
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
