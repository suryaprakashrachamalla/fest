import type { sheets_v4 } from "googleapis";

// An in-memory stand-in for the Google Sheets API, for tests (never Google's API). Just enough for
// the sync and the analytics: tabs with IDs and a limited number of grid rows (new tabs start small;
// like a real grid they must be extended before writing below it), header rows, whole-tab and
// ranged reads, row writes and row deletion. Missing tabs fail like Google's API does, and
// `failures.nextRead` makes the next read fail like an outage.
export function createFakeSheets() {
    const tabs = new Map<string, unknown[][]>();
    const grids = new Map<string, { sheetId: number; rowCount: number }>();
    const failures: { nextRead?: Error } = {};
    let nextSheetId = 100;

    function gridOf(title: string) {
        if (!grids.has(title)) grids.set(title, { sheetId: nextSheetId++, rowCount: 6 });
        return grids.get(title)!;
    }
    function titleOfSheet(sheetId: number) {
        return [...tabs.keys()].find((title) => gridOf(title).sheetId === sheetId)!;
    }
    function parseRange(range: string) {
        const match = range.match(/^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?)?$/);
        if (!match) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
        const title = match[1].replace(/''/g, "'");
        if (!tabs.has(title)) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
        return {
            title,
            grid: tabs.get(title)!,
            startRow: match[3] ? Number(match[3]) : 1,
            endRow: match[5] ? Number(match[5]) : undefined,
        };
    }

    const client = {
        spreadsheets: {
            get: async () => ({
                data: {
                    sheets: [...tabs.keys()].map((title) => ({
                        properties: { title, sheetId: gridOf(title).sheetId, gridProperties: { rowCount: gridOf(title).rowCount } },
                    })),
                },
            }),
            batchUpdate: async ({ requestBody }: { requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }) => {
                for (const request of requestBody.requests ?? []) {
                    if (request.addSheet) {
                        const title = request.addSheet.properties?.title;
                        if (!title || tabs.has(title)) throw Object.assign(new Error("bad addSheet"), { code: 400 });
                        tabs.set(title, []);
                        gridOf(title);
                    } else if (request.appendDimension) {
                        gridOf(titleOfSheet(request.appendDimension.sheetId!)).rowCount += request.appendDimension.length!;
                    } else if (request.deleteDimension) {
                        const { sheetId, startIndex, endIndex } = request.deleteDimension.range!;
                        const title = titleOfSheet(sheetId!);
                        tabs.get(title)!.splice(startIndex!, endIndex! - startIndex!);
                        gridOf(title).rowCount -= endIndex! - startIndex!;
                    } else throw Object.assign(new Error("unsupported request"), { code: 400 });
                }
                return { data: {} };
            },
            values: {
                batchGet: async ({ ranges }: { ranges: string[] }) => {
                    if (failures.nextRead) {
                        const error = failures.nextRead;
                        delete failures.nextRead;
                        throw error;
                    }
                    return {
                        data: {
                            valueRanges: ranges.map((range) => {
                                const { grid, startRow, endRow } = parseRange(range);
                                const rows = grid.slice(startRow - 1, endRow ?? grid.length).map((row) => [...(row ?? [])]);
                                // Like the real API: trailing empty rows are left out.
                                while (rows.length && rows[rows.length - 1].every((cell) => cell === "" || cell == null)) rows.pop();
                                return { values: rows };
                            }),
                        },
                    };
                },
                batchUpdate: async ({ requestBody }: { requestBody: sheets_v4.Schema$BatchUpdateValuesRequest }) => {
                    for (const write of requestBody.data ?? []) {
                        const { title, grid, startRow } = parseRange(write.range!);
                        const lastRow = startRow + (write.values ?? []).length - 1;
                        if (lastRow > gridOf(title).rowCount)
                            throw Object.assign(new Error(`Range (${write.range}) exceeds grid limits`), { code: 400 });
                        (write.values ?? []).forEach((row, index) => (grid[startRow - 1 + index] = [...row]));
                    }
                    return { data: {} };
                },
            },
        },
    } as unknown as sheets_v4.Sheets;

    return { client, tabs, grids, gridOf, failures };
}
