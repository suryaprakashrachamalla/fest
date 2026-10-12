export type SyncItem<TPayload extends Record<string, unknown>, TEntity extends string> = {
    id: string;
    entityType: TEntity;
    entityId: string;
    payload: TPayload;
    createdAt: Date;
};

export function coalesceUpdates<
    TPayload extends Record<string, unknown>,
    TEntity extends string,
>(
    items: SyncItem<TPayload, TEntity>[],
) {
    const groups = new Map<string, { item: SyncItem<TPayload, TEntity>; outboxIds: string[] }>();
    const orderedItems = [...items].sort((left, right) => {
        const timeDifference = left.createdAt.getTime() - right.createdAt.getTime();
        return timeDifference || left.id.localeCompare(right.id);
    });

    for (const item of orderedItems) {
        const key = `${item.entityType}:${item.entityId}`;
        const existing = groups.get(key);
        if (existing) {
            existing.item = item;
            existing.outboxIds.push(item.id);
        } else {
            groups.set(key, { item, outboxIds: [item.id] });
        }
    }

    return Array.from(groups.values()).map(({ item, outboxIds }) => ({
        entityType: item.entityType,
        entityId: item.entityId,
        payload: item.payload,
        outboxIds,
    }));
}

export function planSheetRows(
    idColumn: string,
    headers: string[],
    items: Array<{ entityId: string; payload: Record<string, unknown> }>,
    currentRows: unknown[][],
) {
    const idIndex = headers.indexOf(idColumn);
    if (idIndex < 0) throw new Error(`Unknown stable identifier column: ${idColumn}`);

    const existingRows = new Map<string, number>();
    const duplicateIds = new Set<string>();
    currentRows.slice(1).forEach((row, index) => {
        const stableId = String(row[idIndex] ?? "");
        if (!stableId) return;
        if (existingRows.has(stableId)) duplicateIds.add(stableId);
        else existingRows.set(stableId, index + 2);
    });

    const updates: Array<{ rowNumber: number; values: unknown[] }> = [];
    const appendRows: unknown[][] = [];
    for (const item of items) {
        const stableId = item.payload[idColumn];
        if (typeof stableId !== "string" || stableId !== item.entityId) {
            throw new Error(`Outbox payload identifier does not match ${idColumn}`);
        }
        if (duplicateIds.has(stableId)) {
            throw new Error(`Duplicate ${idColumn} ${stableId} found; no row was changed`);
        }
        const values = headers.map((header) => {
            const value = item.payload[header];
            if (value === undefined || value === null) return "";
            if (typeof value === "object") return JSON.stringify(value);
            return value;
        });
        const rowNumber = existingRows.get(stableId);
        if (rowNumber) updates.push({ rowNumber, values });
        else appendRows.push(values);
    }

    return { updates, appendRows };
}

export function isTransientSheetsFailure(error: unknown) {
    const value = error as {
        code?: number | string;
        response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } };
        errors?: { reason?: string }[];
    };
    const status = Number(value.response?.status ?? value.code);
    const reason = [...(value.errors ?? []), ...(value.response?.data?.error?.errors ?? [])]
        .map((entry) => entry.reason ?? "")
        .join(" ")
        .toLowerCase();

    if (status === 429 || status >= 500) return true;
    if (reason.includes("ratelimit") || reason.includes("quota") || reason.includes("backenderror"))
        return true;
    if (status === 400 || status === 401 || status === 403 || status === 404) return false;
    return true;
}

// True when a worksheet's header row is the start of the expected headers, i.e. columns were
// appended since the sheet was created; the header row can then simply be extended.
export function headersArePrefix(actual: unknown[], expected: string[]) {
    const filled = actual.map((cell) => (cell === undefined || cell === null ? "" : String(cell)));
    while (filled.length && filled[filled.length - 1] === "") filled.pop();
    return filled.length > 0 && filled.length < expected.length && filled.every((cell, i) => cell === expected[i]);
}

// Worksheet name for an event's own tab: the event name without characters Sheets rejects, kept
// apart from the shared tabs (an event called "Events" gets "Events (event)").
export function eventTabTitle(eventName: string, reservedTitles: string[]) {
    const cleaned = eventName.replace(/[[\]*?/\:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Event";
    const reserved = reservedTitles.some((title) => title.toLowerCase() === cleaned.toLowerCase());
    return reserved ? `${cleaned} (event)` : cleaned;
}

// A tab name compared the way organizers see it: case, spaces and punctuation don't matter.
function tabKey(title: string) {
    return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string) {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++)
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
    }
    return previous[b.length];
}

// Finds the tab a wanted worksheet was renamed to in the spreadsheet, so organizers can rename tabs
// freely: the same name ignoring case and punctuation ("Build Lab — Product Design Challenge" ->
// "BUILD-LAB PRODUCT DESIGN CHALLENGE"), or, for longer names, one or two typos away. Only an
// unclaimed tab that is the single closest match is used; otherwise null (the tab gets created).
export function findRenamedTab(wanted: string, existingTitles: string[], claimed: Set<string>) {
    const key = tabKey(wanted);
    const free = existingTitles.filter((title) => !claimed.has(title));
    const same = free.filter((title) => tabKey(title) === key);
    if (same.length === 1) return same[0];
    if (same.length > 1 || key.length < 12) return null;
    const near = free.filter((title) => editDistance(tabKey(title), key) <= 2);
    return near.length === 1 ? near[0] : null;
}

function trimmedCells(row: unknown[]) {
    const cells = row.map((cell) => (cell === undefined || cell === null ? "" : String(cell)));
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
}

// Rows the sync wrote by mistake and can remove without losing anything, as 1-based row numbers,
// highest first (so deleting them in order keeps the others in place):
// - exact copies of an earlier row with the same ID (every cell equal; the first copy stays);
// - rows written shifted to the right (ID column empty, the synced columns further along) whose ID
//   already has a correctly placed row (and most of its columns filled, unlike a typed note).
// Rows with the same ID but different content are left alone; so are rows without a known ID.
export function findRemovableRows(rows: unknown[][], idIndex: number, columnCount: number) {
    const placed = new Map<string, string>();
    const remove: number[] = [];
    rows.forEach((row, index) => {
        if (index === 0) return;
        const cells = trimmedCells(row);
        const id = cells[idIndex] ?? "";
        if (!id) return;
        const content = JSON.stringify(cells);
        if (!placed.has(id)) placed.set(id, content);
        else if (placed.get(id) === content) remove.push(index + 1);
    });
    rows.forEach((row, index) => {
        if (index === 0) return;
        const cells = trimmedCells(row);
        if (cells[idIndex]) return;
        const start = cells.findIndex((cell) => cell !== "");
        if (start <= 0) return;
        const shifted = cells.slice(start);
        const id = shifted[idIndex] ?? "";
        // A real shifted copy fills most columns; a note that merely mentions an ID does not.
        const filled = shifted.filter((cell) => cell !== "").length;
        if (id && placed.has(id) && shifted.length <= columnCount && filled >= Math.ceil(columnCount / 2))
            remove.push(index + 1);
    });
    return remove.sort((left, right) => right - left);
}
