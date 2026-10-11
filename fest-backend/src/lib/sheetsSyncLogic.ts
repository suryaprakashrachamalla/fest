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
