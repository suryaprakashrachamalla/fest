import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";

// Payment screenshots in Google Drive: the shourya2026 account's Drive, with access limited to the
// files this app creates (drive.file). Files go in a private folder per event:
//   SHOURYA'26 payment screenshots / <event name> / <registration ID>_<UTR>.<png|jpg>
// Connect the account once with: bun src/lib/driveAuth.ts <oauth-client.json>

const ROOT_FOLDER = process.env.GOOGLE_DRIVE_FOLDER_NAME?.trim() || "SHOURYA'26 payment screenshots";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

let client: drive_v3.Drive | null = null;
let testClient: drive_v3.Drive | null = null;
const folders = new Map<string, string>();

export function driveConfigured() {
    return Boolean(
        testClient ||
            (process.env.GMAIL_CLIENT_ID?.trim() &&
                process.env.GMAIL_CLIENT_SECRET?.trim() &&
                process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()),
    );
}

// Tests use an in-memory Drive instead of Google's API.
export function setDriveClientForTests(fake: drive_v3.Drive | null) {
    testClient = fake;
    folders.clear();
}

function drive() {
    if (testClient) return testClient;
    if (client) return client;
    const oauth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
    client = google.drive({ version: "v3", auth: oauth });
    return client;
}

// Drive search strings are quoted with '; backslashes and quotes inside are escaped.
const quoted = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

async function folder(name: string, parent?: string) {
    const key = `${parent ?? "root"}/${name}`;
    const cached = folders.get(key);
    if (cached) return cached;
    const found = await drive().files.list({
        q: `mimeType = '${FOLDER_TYPE}' and name = ${quoted(name)} and trashed = false and ${quoted(parent ?? "root")} in parents`,
        fields: "files(id)",
        pageSize: 1,
        spaces: "drive",
    });
    let id = found.data.files?.[0]?.id ?? undefined;
    if (!id) {
        const created = await drive().files.create({
            requestBody: { name, mimeType: FOLDER_TYPE, parents: parent ? [parent] : undefined },
            fields: "id",
        });
        id = created.data.id ?? undefined;
    }
    if (!id) throw new Error(`Couldn't create the "${name}" folder in Google Drive`);
    folders.set(key, id);
    return id;
}

// Copies one screenshot to Drive and returns the file ID. Safe to repeat: a file already uploaded
// for this proof (e.g. the server stopped before recording it) is reused, not uploaded twice.
// The copy only counts when Drive reports the same size as the original.
export async function uploadScreenshot(input: {
    proofId: string;
    eventName: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
}) {
    const existing = await drive().files.list({
        q: `appProperties has { key='proofId' and value=${quoted(input.proofId)} } and trashed = false`,
        fields: "files(id,size)",
        pageSize: 1,
        spaces: "drive",
    });
    const previous = existing.data.files?.[0];
    if (previous?.id && Number(previous.size) === input.bytes.length) return previous.id;

    const parent = await folder(input.eventName, await folder(ROOT_FOLDER));
    const created = await drive().files.create({
        requestBody: { name: input.fileName, parents: [parent], appProperties: { proofId: input.proofId } },
        media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.bytes)) },
        fields: "id,size",
    });
    if (!created.data.id) throw new Error("Google Drive didn't return a file ID");
    if (Number(created.data.size) !== input.bytes.length)
        throw new Error(`Google Drive stored ${created.data.size} bytes instead of ${input.bytes.length}`);
    return created.data.id;
}

export async function downloadScreenshot(fileId: string) {
    const response = await drive().files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(response.data as ArrayBuffer);
}
