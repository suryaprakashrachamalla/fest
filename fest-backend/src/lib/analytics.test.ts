// @ts-ignore Bun provides this module at runtime; the project does not use Bun ambient types.
import { describe, expect, test } from "bun:test";
import { classify, filterRecords, readEventTab, toCsv, totalsOf } from "./analytics.ts";

const tab = { eventId: "11111111-1111-1111-1111-111111111111", event: "CSE-HACKATHON", title: "CSE-HACKATHON" };
// The event tab's columns, as the sheet sync writes them.
const header = [
    "registrationId", "teamName", "teamSize", "participantNames", "emails", "rollNumbers", "phone", "college",
    "registrationFee", "utr", "paymentStatus", "approvalStatus", "ticketStatus", "emailStatus", "checkedIn",
    "checkedInAt", "registeredAt", "updatedAt",
];
function row(id: string, values: Partial<Record<string, unknown>> = {}) {
    const defaults: Record<string, unknown> = {
        registrationId: id, teamName: `Team ${id}`, teamSize: 2, participantNames: "Ana, Bo", emails: "ana@x.in, bo@x.in",
        registrationFee: "798.00", utr: "UTR1", paymentStatus: "VERIFIED", approvalStatus: "APPROVED",
        ticketStatus: "ISSUED", emailStatus: "SENT 2/2", checkedIn: false, registeredAt: "2026-10-12T10:00:00.000Z",
    };
    return header.map((name) => (name in values ? values[name] : (defaults[name] ?? "")));
}

describe("reading an event tab", () => {
    test("an empty or missing tab gives no records and no errors", () => {
        expect(readEventTab(tab, []).records).toEqual([]);
        expect(readEventTab(tab, [header]).records).toEqual([]);
        expect(readEventTab(tab, []).quality.missingColumns).toEqual([]);
    });

    test("blank rows, rows without an ID and repeated IDs are skipped and reported, not counted", () => {
        const { records, quality } = readEventTab(tab, [
            header,
            row("SG26-AAAAAAAA"),
            [],
            ["", "", "", ""],
            row(""),
            row("SG26-AAAAAAAA", { teamSize: 3 }),
            row("sg26-bbbbbbbb"),
        ]);
        expect(records.map((r) => r.registrationId)).toEqual(["SG26-AAAAAAAA", "SG26-BBBBBBBB"]);
        // The first row of a repeated ID is the one used.
        expect(records[0].teamSize).toBe(2);
        expect(quality).toEqual({
            rows: 4,
            blankRows: 2,
            rowsWithoutId: 1,
            duplicateIds: ["SG26-AAAAAAAA"],
            missingColumns: [],
            rowsWithProblems: 0,
        });
    });

    test("missing columns are reported and malformed cells count as zero with the problem noted", () => {
        const { records, quality } = readEventTab(tab, [
            ["registrationId", "teamSize", "approvalStatus"],
            ["SG26-AAAAAAAA", "two", "APPROVED"],
        ]);
        expect(quality.missingColumns).toEqual(["registrationFee", "paymentStatus"]);
        expect(records[0].teamSize).toBe(0);
        expect(records[0].problems[0]).toMatch(/teamSize "two"/);
        expect(quality.rowsWithProblems).toBe(1);
    });

    test("columns are found by header name in any order, and statuses are case-insensitive", () => {
        const { records } = readEventTab(tab, [
            ["approvalStatus", "registrationFee", "teamSize", "registrationId", "paymentStatus"],
            ["approved ", "₹1,197.00", 3, "SG26-AAAAAAAA", "verified"],
        ]);
        expect(records[0]).toMatchObject({ approvalStatus: "APPROVED", paymentStatus: "VERIFIED", registrationFeePaise: 119_700, teamSize: 3 });
    });
});

describe("totals and test-data exclusion", () => {
    const { records } = readEventTab(tab, [
        header,
        row("SG26-AAAAAAAA", { checkedIn: "2/2 entered" }),
        row("SG26-BBBBBBBB", { teamSize: 3, registrationFee: "1197.00", checkedIn: "1/3 entered" }),
        row("SG26-CCCCCCCC", { paymentStatus: "PENDING", approvalStatus: "PENDING", registrationFee: "798.00" }),
        row("SG26-DDDDDDDD", { paymentStatus: "REJECTED", approvalStatus: "REJECTED" }),
        row("SG26-TESTTEST", { teamSize: 1, registrationFee: "399.00" }),
    ]);
    const classified = classify(records, new Map([["SG26-TESTTEST", "Test account qa@x.in: QA run"]]));

    test("only approved registrations count as accepted teams and revenue", () => {
        expect(totalsOf(classified.filter((r) => !r.excluded))).toEqual({
            registrations: 4,
            participants: 9,
            approvedTeams: 2,
            approvedParticipants: 5,
            approvedAmountPaise: 199_500,
            paymentsVerified: 2,
            paymentsUnderReview: 1,
            paymentsRejected: 1,
            participantsEntered: 3,
        });
    });

    test("excluded test records are counted only on their own, with the reason", () => {
        const excluded = classified.filter((r) => r.excluded);
        expect(excluded.map((r) => r.registrationId)).toEqual(["SG26-TESTTEST"]);
        expect(excluded[0].exclusionReason).toBe("Test account qa@x.in: QA run");
        expect(totalsOf(excluded)).toMatchObject({ registrations: 1, approvedTeams: 1, approvedAmountPaise: 39_900 });
    });

    test("a team check-in from before members were scanned counts the whole team as entered", () => {
        const { records: legacy } = readEventTab(tab, [header, row("SG26-EEEEEEEE", { teamSize: 3, checkedIn: true })]);
        expect(totalsOf(legacy).participantsEntered).toBe(3);
    });
});

describe("filtering records", () => {
    const { records } = readEventTab(tab, [
        header,
        row("SG26-AAAAAAAA", { emails: "nikhil@mvsr.in", participantNames: "Nikhil Rao", registeredAt: "2026-10-10T08:00:00.000Z" }),
        row("SG26-BBBBBBBB", { paymentStatus: "PENDING", approvalStatus: "PENDING", registeredAt: "2026-10-11T23:30:00.000Z" }),
        row("SG26-TESTTEST", { registeredAt: "2026-10-12T08:00:00.000Z" }),
    ]);
    const classified = classify(records, new Map([["SG26-TESTTEST", "Test registration: dry run"]]));
    const ids = (filter: Parameters<typeof filterRecords>[1]) => filterRecords(classified, filter).map((r) => r.registrationId);

    test("production is the default scope; test data is available on request", () => {
        expect(ids({})).toEqual(["SG26-AAAAAAAA", "SG26-BBBBBBBB"]);
        expect(ids({ scope: "excluded" })).toEqual(["SG26-TESTTEST"]);
        expect(ids({ scope: "all" })).toHaveLength(3);
    });

    test("search by registration ID prefix, email or name", () => {
        expect(ids({ q: "sg26-bbb" })).toEqual(["SG26-BBBBBBBB"]);
        expect(ids({ q: "nikhil@" })).toEqual(["SG26-AAAAAAAA"]);
        expect(ids({ q: "rao" })).toEqual(["SG26-AAAAAAAA"]);
        expect(ids({ q: "nobody" })).toEqual([]);
    });

    test("filter by payment, approval, event and registration date (a date-only end includes that day)", () => {
        expect(ids({ payment: "pending" })).toEqual(["SG26-BBBBBBBB"]);
        expect(ids({ approval: "APPROVED" })).toEqual(["SG26-AAAAAAAA"]);
        expect(ids({ eventId: "another-event" })).toEqual([]);
        expect(ids({ from: "2026-10-11", to: "2026-10-11" })).toEqual(["SG26-BBBBBBBB"]);
    });
});

test("CSV export quotes commas and neutralizes cells that would run as spreadsheet formulas", () => {
    const { records } = readEventTab(tab, [header, row("SG26-AAAAAAAA", { participantNames: '=HYPERLINK("http://evil")', teamName: "A, B" })]);
    const csv = toCsv(classify(records, new Map()));
    const [head, line] = csv.split("\r\n");
    expect(head.startsWith("Registration ID,Event,Team")).toBe(true);
    expect(line).toContain('"A, B"');
    expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(line.endsWith(",no,")).toBe(true);
});
