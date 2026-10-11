// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { describe, expect, test } from "bun:test";
import {
    coalesceUpdates,
    headersArePrefix,
    isTransientSheetsFailure,
    planSheetRows,
} from "./sheetsSyncLogic.ts";

describe("Google Sheets sync planning", () => {
    test("coalesces repeated updates to the latest entity state", () => {
        const first = new Date("2026-10-10T10:00:00.000Z");
        const second = new Date("2026-10-10T10:01:00.000Z");
        const result = coalesceUpdates([
            {
                id: "job-1",
                entityType: "REGISTRATION",
                entityId: "registration-1",
                payload: { registrationId: "registration-1", verified: false },
                createdAt: first,
            },
            {
                id: "job-2",
                entityType: "REGISTRATION",
                entityId: "registration-1",
                payload: { registrationId: "registration-1", verified: true },
                createdAt: second,
            },
        ]);

        expect(result).toHaveLength(1);
        expect(result[0]?.payload.verified).toBe(true);
        expect(result[0]?.outboxIds).toEqual(["job-1", "job-2"]);
    });

    test("plans multiple new rows together and updates existing IDs in place", () => {
        const headers = ["registrationId", "status"];
        const plan = planSheetRows(
            "registrationId",
            headers,
            [
                { entityId: "r1", payload: { registrationId: "r1", status: "verified" } },
                { entityId: "r2", payload: { registrationId: "r2", status: "pending" } },
            ],
            [headers, ["r1", "pending"]],
        );

        expect(plan.updates).toEqual([{ rowNumber: 2, values: ["r1", "verified"] }]);
        expect(plan.appendRows).toEqual([["r2", "pending"]]);
    });

    test("retries an already appended stable ID as an update instead of another append", () => {
        const headers = ["participantId", "name"];
        const payload = { participantId: "p1", name: "Ayesha" };
        const retryPlan = planSheetRows(
            "participantId",
            headers,
            [{ entityId: "p1", payload }],
            [headers, ["p1", "Ayesha"]],
        );

        expect(retryPlan.updates).toEqual([{ rowNumber: 2, values: ["p1", "Ayesha"] }]);
        expect(retryPlan.appendRows).toEqual([]);
    });

    test("refuses to change a worksheet when the stable ID is duplicated", () => {
        expect(() =>
            planSheetRows(
                "proofId",
                ["proofId", "status"],
                [{ entityId: "proof-1", payload: { proofId: "proof-1", status: "VERIFIED" } }],
                [["proofId", "status"], ["proof-1", "PENDING"], ["proof-1", "REJECTED"]],
            ),
        ).toThrow("Duplicate proofId proof-1");
    });

    test("retries temporary Sheets failures and surfaces permanent credential failures", () => {
        expect(isTransientSheetsFailure({ response: { status: 429 } })).toBe(true);
        expect(isTransientSheetsFailure({ response: { status: 503 } })).toBe(true);
        expect(isTransientSheetsFailure({ response: { status: 401 } })).toBe(false);
    });
});

describe("worksheet header upgrades", () => {
    const headers = ["participantId", "name", "createdAt", "ticketEmailStatus", "checkedInAt"];
    test("an older header row that is a prefix of the new one can be extended", () => {
        expect(headersArePrefix(["participantId", "name", "createdAt"], headers)).toBe(true);
        expect(headersArePrefix(["participantId", "name", "createdAt", "", ""], headers)).toBe(true);
    });
    test("renamed, reordered, empty or identical header rows are not treated as upgrades", () => {
        expect(headersArePrefix(["participantId", "fullName", "createdAt"], headers)).toBe(false);
        expect(headersArePrefix(["name", "participantId"], headers)).toBe(false);
        expect(headersArePrefix([], headers)).toBe(false);
        expect(headersArePrefix(headers, headers)).toBe(false);
    });
});
