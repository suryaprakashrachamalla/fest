import type { drive_v3 } from "googleapis";

type FakeFile = { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; bytes: Buffer };

// An in-memory stand-in for the Google Drive API, for tests (never Google's API): folders, uploads,
// downloads and the searches the screenshot storage uses. `failures` makes the next call fail.
export function createFakeDrive() {
    const files = new Map<string, FakeFile>();
    const failures: { nextUpload?: Error; nextDownload?: Error; wrongSize?: boolean } = {};
    let next = 1;

    // Understands the queries driveStorage sends: a folder by name and parent, or a proof ID.
    function matches(file: FakeFile, q: string) {
        const proof = q.match(/key='proofId' and value='([^']+)'/);
        if (proof) return file.appProperties.proofId === proof[1];
        const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, "$1");
        const parent = q.match(/'([^']+)' in parents/)?.[1];
        return file.mimeType === "application/vnd.google-apps.folder" && file.name === name && file.parents.includes(parent ?? "root");
    }

    const client = {
        files: {
            list: async ({ q }: { q: string }) => ({
                data: { files: [...files.values()].filter((f) => matches(f, q)).map((f) => ({ id: f.id, size: String(f.bytes.length) })) },
            }),
            create: async ({ requestBody, media }: { requestBody: drive_v3.Schema$File; media?: { mimeType: string; body: NodeJS.ReadableStream } }) => {
                if (media && failures.nextUpload) {
                    const error = failures.nextUpload;
                    delete failures.nextUpload;
                    throw error;
                }
                const chunks: Buffer[] = [];
                if (media) for await (const chunk of media.body) chunks.push(Buffer.from(chunk as Buffer));
                let bytes = Buffer.concat(chunks);
                if (failures.wrongSize) {
                    delete failures.wrongSize;
                    bytes = bytes.subarray(0, Math.max(0, bytes.length - 1));
                }
                const id = `file-${next++}`;
                files.set(id, {
                    id,
                    name: requestBody.name ?? "",
                    mimeType: requestBody.mimeType ?? media?.mimeType ?? "",
                    parents: requestBody.parents ?? ["root"],
                    appProperties: (requestBody.appProperties as Record<string, string>) ?? {},
                    bytes,
                });
                return { data: { id, size: String(bytes.length) } };
            },
            get: async ({ fileId }: { fileId: string }) => {
                if (failures.nextDownload) {
                    const error = failures.nextDownload;
                    delete failures.nextDownload;
                    throw error;
                }
                const file = files.get(fileId);
                if (!file) throw Object.assign(new Error("File not found"), { code: 404 });
                return { data: file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.length) };
            },
        },
    } as unknown as drive_v3.Drive;

    const pathOf = (file: FakeFile): string => {
        const parent = files.get(file.parents[0]);
        return parent ? `${pathOf(parent)}/${file.name}` : file.name;
    };
    const uploads = () => [...files.values()].filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
    return { client, files, failures, uploads, pathOf };
}
