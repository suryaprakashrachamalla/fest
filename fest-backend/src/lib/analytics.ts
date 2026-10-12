// Super-admin analytics, computed from the rows of each event's tab in the Google Sheet. Pure
// functions: reading the sheet, the database and the exclusion rules happens in AnalyticsService.

// One registration row from an event tab, with the cells the analytics use.
export type SheetRecord = {
    registrationId: string;
    eventId: string;
    event: string;
    tab: string;
    rowNumber: number;
    teamName: string;
    teamSize: number;
    participantNames: string;
    emails: string[];
    registrationFeePaise: number;
    utr: string;
    paymentStatus: string;
    approvalStatus: string;
    ticketStatus: string;
    emailStatus: string;
    membersEntered: number;
    registeredAt: string;
    // Cells that couldn't be read (e.g. a team size that isn't a number); counted as 0.
    problems: string[];
};

export type TabQuality = {
    rows: number;
    blankRows: number;
    rowsWithoutId: number;
    duplicateIds: string[];
    missingColumns: string[];
    rowsWithProblems: number;
};

// Columns the totals depend on. Others are optional.
export const REQUIRED_COLUMNS = ["registrationId", "teamSize", "registrationFee", "paymentStatus", "approvalStatus"];

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value).trim());

function feePaise(value: unknown, problems: string[]) {
    const raw = text(value);
    if (!raw) return 0;
    const amount = Number(raw.replace(/[₹,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
        problems.push(`registrationFee "${raw}" isn't an amount`);
        return 0;
    }
    return Math.round(amount * 100);
}

function teamSize(value: unknown, problems: string[]) {
    const size = Number(text(value));
    if (!Number.isInteger(size) || size < 1 || size > 50) {
        problems.push(`teamSize "${text(value)}" isn't a team size`);
        return 0;
    }
    return size;
}

// "2/3 entered" from the sync; TRUE/FALSE from a team-level check-in before members were scanned.
function membersEntered(value: unknown, size: number) {
    const raw = text(value);
    const match = raw.match(/^(\d+)\s*\/\s*\d+/);
    if (match) return Number(match[1]);
    return /^true$/i.test(raw) ? size : 0;
}

// Turns one event tab (header row first) into records, skipping blank rows, rows without a
// registration ID and repeated IDs (the first row of an ID is used), and reports what it skipped.
export function readEventTab(
    tab: { eventId: string; event: string; title: string },
    rows: unknown[][],
): { records: SheetRecord[]; quality: TabQuality } {
    const [header = [], ...data] = rows;
    const names = header.map(text);
    const col = (name: string) => names.indexOf(name);
    const cell = (row: unknown[], name: string) => (col(name) >= 0 ? row[col(name)] : undefined);
    const quality: TabQuality = {
        rows: 0,
        blankRows: 0,
        rowsWithoutId: 0,
        duplicateIds: [],
        missingColumns: rows.length ? REQUIRED_COLUMNS.filter((name) => col(name) < 0) : [],
        rowsWithProblems: 0,
    };
    const seen = new Set<string>();
    const records: SheetRecord[] = [];
    data.forEach((row, index) => {
        if (!Array.isArray(row) || row.every((value) => text(value) === "")) {
            quality.blankRows++;
            return;
        }
        quality.rows++;
        const registrationId = text(cell(row, "registrationId")).toUpperCase();
        if (!registrationId) {
            quality.rowsWithoutId++;
            return;
        }
        if (seen.has(registrationId)) {
            if (!quality.duplicateIds.includes(registrationId)) quality.duplicateIds.push(registrationId);
            return;
        }
        seen.add(registrationId);
        const problems: string[] = [];
        const size = teamSize(cell(row, "teamSize"), problems);
        const record: SheetRecord = {
            registrationId,
            eventId: tab.eventId,
            event: tab.event,
            tab: tab.title,
            rowNumber: index + 2,
            teamName: text(cell(row, "teamName")),
            teamSize: size,
            participantNames: text(cell(row, "participantNames")),
            emails: text(cell(row, "emails"))
                .split(",")
                .map((email) => email.trim().toLowerCase())
                .filter(Boolean),
            registrationFeePaise: feePaise(cell(row, "registrationFee"), problems),
            utr: text(cell(row, "utr")),
            paymentStatus: text(cell(row, "paymentStatus")).toUpperCase() || "NOT_SUBMITTED",
            approvalStatus: text(cell(row, "approvalStatus")).toUpperCase() || "PENDING",
            ticketStatus: text(cell(row, "ticketStatus")).toUpperCase(),
            emailStatus: text(cell(row, "emailStatus")),
            membersEntered: membersEntered(cell(row, "checkedIn"), size),
            registeredAt: text(cell(row, "registeredAt")),
            problems,
        };
        if (problems.length) quality.rowsWithProblems++;
        records.push(record);
    });
    return { records, quality };
}

export type Classified = SheetRecord & { excluded: boolean; exclusionReason: string | null };

// Registration ID -> why it is left out of the production numbers.
export type ExclusionIndex = Map<string, string>;

export function classify(records: SheetRecord[], excluded: ExclusionIndex): Classified[] {
    return records.map((record) => {
        const reason = excluded.get(record.registrationId) ?? null;
        return { ...record, excluded: reason !== null, exclusionReason: reason };
    });
}

export type Totals = {
    registrations: number;
    participants: number;
    approvedTeams: number;
    approvedParticipants: number;
    approvedAmountPaise: number;
    paymentsVerified: number;
    paymentsUnderReview: number;
    paymentsRejected: number;
    participantsEntered: number;
};

export function emptyTotals(): Totals {
    return {
        registrations: 0,
        participants: 0,
        approvedTeams: 0,
        approvedParticipants: 0,
        approvedAmountPaise: 0,
        paymentsVerified: 0,
        paymentsUnderReview: 0,
        paymentsRejected: 0,
        participantsEntered: 0,
    };
}

// Accepted (approved) registrations are the ones counted as revenue; the sync writes APPROVED
// for both approved teams and teams whose tickets were emailed.
export function totalsOf(records: SheetRecord[]): Totals {
    const totals = emptyTotals();
    for (const record of records) {
        totals.registrations++;
        totals.participants += record.teamSize;
        if (record.approvalStatus === "APPROVED") {
            totals.approvedTeams++;
            totals.approvedParticipants += record.teamSize;
            totals.approvedAmountPaise += record.registrationFeePaise;
        }
        if (record.paymentStatus === "VERIFIED") totals.paymentsVerified++;
        else if (record.paymentStatus === "PENDING") totals.paymentsUnderReview++;
        else if (record.paymentStatus === "REJECTED") totals.paymentsRejected++;
        totals.participantsEntered += record.membersEntered;
    }
    return totals;
}

export function addTotals(a: Totals, b: Totals): Totals {
    const sum = emptyTotals();
    for (const key of Object.keys(sum) as (keyof Totals)[]) sum[key] = a[key] + b[key];
    return sum;
}

export type RecordFilter = {
    // Registration ID (exact or prefix), or part of a participant's name or email.
    q?: string;
    eventId?: string;
    payment?: string;
    approval?: string;
    // production (default), excluded (test data) or all.
    scope?: "production" | "excluded" | "all";
    from?: string;
    to?: string;
};

export function filterRecords(records: Classified[], filter: RecordFilter) {
    const q = filter.q?.trim().toLowerCase() ?? "";
    const from = filter.from ? Date.parse(filter.from) : NaN;
    // A date-only "to" includes that whole day.
    const to = filter.to ? Date.parse(filter.to) + (/^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? 86_400_000 - 1 : 0) : NaN;
    const scope = filter.scope ?? "production";
    return records.filter((record) => {
        if (scope === "production" && record.excluded) return false;
        if (scope === "excluded" && !record.excluded) return false;
        if (filter.eventId && record.eventId !== filter.eventId) return false;
        if (filter.payment && record.paymentStatus !== filter.payment.toUpperCase()) return false;
        if (filter.approval && record.approvalStatus !== filter.approval.toUpperCase()) return false;
        const registered = Date.parse(record.registeredAt);
        if (!Number.isNaN(from) && !(registered >= from)) return false;
        if (!Number.isNaN(to) && !(registered <= to)) return false;
        if (
            q &&
            !record.registrationId.toLowerCase().startsWith(q) &&
            !record.emails.some((email) => email.includes(q)) &&
            !record.participantNames.toLowerCase().includes(q) &&
            !record.teamName.toLowerCase().includes(q)
        )
            return false;
        return true;
    });
}

// CSV for spreadsheets. Cells starting with = + - @ (or a tab/CR) are prefixed with ' so a
// registrant's name can't run as a formula when the export is opened in Excel or Sheets.
export function toCsv(records: Classified[]) {
    const columns: [string, (r: Classified) => unknown][] = [
        ["Registration ID", (r) => r.registrationId],
        ["Event", (r) => r.event],
        ["Team", (r) => r.teamName],
        ["Team size", (r) => r.teamSize],
        ["Participants", (r) => r.participantNames],
        ["Emails", (r) => r.emails.join(", ")],
        ["Fee (Rs)", (r) => (r.registrationFeePaise / 100).toFixed(2)],
        ["UTR", (r) => r.utr],
        ["Payment", (r) => r.paymentStatus],
        ["Approval", (r) => r.approvalStatus],
        ["Ticket", (r) => r.ticketStatus],
        ["Members entered", (r) => r.membersEntered],
        ["Registered at", (r) => r.registeredAt],
        ["Test data", (r) => (r.excluded ? "yes" : "no")],
        ["Exclusion reason", (r) => r.exclusionReason ?? ""],
    ];
    const escape = (value: unknown) => {
        let cell = text(value);
        if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
        return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
    };
    return [columns.map(([name]) => name), ...records.map((r) => columns.map(([, get]) => get(r)))]
        .map((row) => row.map(escape).join(","))
        .join("\r\n");
}
