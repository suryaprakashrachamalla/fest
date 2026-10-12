// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { expect, test } from "bun:test";
import { requireSuperAdmin, summarizeEventTab, superAdminEmails } from "./OverviewService.ts";

test("super admins are the ADMIN_SUPER*_EMAIL accounts, case-insensitive", () => {
    const emails = superAdminEmails({
        ADMIN_SUPER_EMAIL: "Lead@Example.com",
        ADMIN_SUPER3_EMAIL: " third@example.com ",
        ADMIN_VOLUNTEER1_EMAIL: "volunteer@example.com",
        ADMIN_SUPERX_EMAIL: "not-a-super@example.com",
    });
    expect([...emails].sort()).toEqual(["lead@example.com", "third@example.com"]);
});

test("only super admins get past the overview guard", () => {
    const previous = process.env.ADMIN_SUPER_EMAIL;
    process.env.ADMIN_SUPER_EMAIL = "lead@example.com";
    const run = (email: string) => {
        let status = 0;
        let passed = false;
        const res = { status: (code: number) => ((status = code), res), json: () => res } as never;
        requireSuperAdmin({ user: { id: "1", name: "x", email, role: "ADMIN" } } as never, res, () => {
            passed = true;
        });
        return passed ? "passed" : status;
    };
    expect(run("LEAD@example.com")).toBe("passed");
    expect(run("volunteer@example.com")).toBe(403);
    process.env.ADMIN_SUPER_EMAIL = previous;
});

test("an event tab counts only accepted (APPROVED) rows", () => {
    const header = ["registrationId", "teamName", "teamSize", "registrationFee", "paymentStatus", "approvalStatus"];
    const summary = summarizeEventTab([
        header,
        ["r1", "A", 3, "1197.00", "VERIFIED", "APPROVED"],
        ["r2", "B", 2, "798.00", "VERIFIED", "approved "],
        ["r3", "C", 3, "1197.00", "PENDING", "PENDING"],
        ["r4", "D", 1, "399.00", "REJECTED", "REJECTED"],
        ["", "", "", "", "", ""],
    ]);
    expect(summary).toEqual({ approvedTeams: 2, approvedParticipants: 5, approvedAmountPaise: 199_500, totalRows: 4 });
});

test("columns are found by header name, whatever their order", () => {
    const summary = summarizeEventTab([
        ["approvalStatus", "registrationFee", "teamSize"],
        ["APPROVED", 149, 2],
    ]);
    expect(summary).toEqual({ approvedTeams: 1, approvedParticipants: 2, approvedAmountPaise: 14_900, totalRows: 1 });
    expect(summarizeEventTab([]).approvedTeams).toBe(0);
});
