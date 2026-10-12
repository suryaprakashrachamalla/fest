// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { describe, expect, test } from "bun:test";
import {
    coalesceUpdates,
    eventTabTitle,
    findRemovableRows,
    findRenamedTab,
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

describe("eventTabTitle", () => {
    const shared = ["Events", "Registrations", "Participants", "PaymentProofs", "Users"];

    test("uses the event name as the tab name", () => {
        expect(eventTabTitle("CSE-HACKATHON", shared)).toBe("CSE-HACKATHON");
        expect(eventTabTitle("NOCODE VIBEATHON", shared)).toBe("NOCODE VIBEATHON");
    });

    test("drops characters Sheets does not allow in tab names", () => {
        expect(eventTabTitle("AI/ML: Build [Lab]?", shared)).toBe("AI ML Build Lab");
    });

    test("never reuses a shared tab", () => {
        expect(eventTabTitle("registrations", shared)).toBe("registrations (event)");
    });
});

describe("findRenamedTab", () => {
    const tabs = [
        "Events", "Registrations", "CSE-HACKATHON", "NOCODE VIBEATHON",
        "BUILD-LAB PRODUCT DESIGN CHALLENGE", "GITHUB+SYSTEM DESGIN WORKSHOP", "STANDUP COMEDY",
    ];
    const none = new Set<string>();

    test("follows tabs renamed with different case or punctuation", () => {
        expect(findRenamedTab("Build Lab — Product Design Challenge", tabs, none)).toBe("BUILD-LAB PRODUCT DESIGN CHALLENGE");
        expect(findRenamedTab("Standup Comedy", tabs, none)).toBe("STANDUP COMEDY");
    });

    test("tolerates a small typo in a longer tab name", () => {
        expect(findRenamedTab("GitHub + System Design Workshop", tabs, none)).toBe("GITHUB+SYSTEM DESGIN WORKSHOP");
    });

    test("never picks a different event's tab or one already in use", () => {
        expect(findRenamedTab("Standup Comedy — Group Pass", tabs, none)).toBeNull();
        expect(findRenamedTab("Standup Comedy", tabs, new Set(["STANDUP COMEDY"]))).toBeNull();
        expect(findRenamedTab("Sangamam", tabs, none)).toBeNull();
    });
});


describe("findRemovableRows", () => {
    const header = ["id", "name", "status"];

    test("removes exact copies of a row, keeping the first", () => {
        const rows = [header, ["A", "Ana", "OK"], ["B", "Bo", "OK"], ["A", "Ana", "OK"], ["A", "Ana", "OK"]];
        expect(findRemovableRows(rows, 0, 3)).toEqual([5, 4]);
    });

    test("keeps rows with the same ID but different content", () => {
        const rows = [header, ["A", "Ana", "OK"], ["A", "Ana", "CHANGED"]];
        expect(findRemovableRows(rows, 0, 3)).toEqual([]);
    });

    test("removes a row written shifted to the right when the ID already has a proper row", () => {
        const rows = [header, ["A", "Ana", "OK"], ["", "", "", "A", "Ana", "OK"], ["", "", "", "Z", "Zed", "OK"]];
        // Z has no proper row yet, so its shifted copy stays until the sync writes Z at column A.
        expect(findRemovableRows(rows, 0, 3)).toEqual([3]);
    });

    test("leaves blank rows and organizers' notes alone", () => {
        const rows = [header, ["A", "Ana", "OK"], [], ["", "", ""], ["", "remember to call A"], ["Note", "for the desk"], ["", "A"]];
        expect(findRemovableRows(rows, 0, 3)).toEqual([]);
    });
});
