// One-time setup: connects the Google Drive where payment screenshots are kept (shourya2026).
//
//   bun src/lib/driveAuth.ts <path to the OAuth client JSON> [env file, default .env.production]
//
// Opens a Google sign-in link; after you allow access to "files this app creates" (the app can't see
// anything else in that Drive), the refresh token is written into the env file (never printed).
// Uses the same OAuth client as the Gmail ticket sender. Needs, in Google Cloud for that project:
// the Google Drive API enabled, and http://localhost:53682/oauth2callback as an authorized redirect URI.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];

const [clientFile, envFileArg] = process.argv.slice(2);
if (!clientFile) {
    console.error("Usage: bun src/lib/driveAuth.ts <oauth-client.json> [env file]");
    process.exit(1);
}
const envFile = path.resolve(envFileArg ?? ".env.production");
const json = JSON.parse(fs.readFileSync(clientFile, "utf8"));
const client = json.web ?? json.installed;
if (!client?.client_id || !client?.client_secret) throw new Error("That file isn't a Google OAuth client JSON");

const oauth = new google.auth.OAuth2(client.client_id, client.client_secret, REDIRECT_URI);
const authUrl = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

// Replaces KEY=... lines in the env file, or appends them.
function writeEnv(values: Record<string, string>) {
    let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
    for (const [key, value] of Object.entries(values)) {
        const line = `${key}=${value}`;
        const pattern = new RegExp(`^${key}=.*$`, "m");
        text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
    }
    fs.writeFileSync(envFile, text);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", REDIRECT_URI);
    if (url.pathname !== "/oauth2callback") return void res.writeHead(404).end();
    const code = url.searchParams.get("code");
    if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end(`Sign-in was cancelled: ${url.searchParams.get("error") ?? "no code"}`);
        return;
    }
    try {
        const { tokens } = await oauth.getToken(code);
        if (!tokens.refresh_token) throw new Error("Google didn't return a refresh token; remove the app's access at myaccount.google.com/permissions and run this again");
        if (!tokens.scope?.includes("drive.file")) throw new Error("Drive access wasn't granted. Run this again and tick the Google Drive permission.");
        const email = tokens.id_token
            ? (JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email
            : undefined;
        // Check Drive actually works for this account before saving (e.g. the Drive API is enabled).
        oauth.setCredentials(tokens);
        await google.drive({ version: "v3", auth: oauth }).files.list({ pageSize: 1, fields: "files(id)", spaces: "drive" });
        writeEnv({ GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token, GOOGLE_DRIVE_ACCOUNT: email ?? "" });
        res.writeHead(200, { "Content-Type": "text/html" }).end(
            `<p style="font-family:sans-serif">Google Drive connected for <b>${email ?? "this account"}</b>. You can close this tab.</p>`,
        );
        console.log(`Connected Google Drive for ${email}. Saved GOOGLE_DRIVE_REFRESH_TOKEN in ${envFile}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const hint = /has not been used|is disabled|accessNotConfigured/i.test(message)
            ? " Turn on the Google Drive API for this Google Cloud project (APIs & Services → Library → Google Drive API → Enable), wait a minute, and run this again."
            : "";
        res.writeHead(500, { "Content-Type": "text/plain" }).end(message + hint);
        console.error("Failed:", message + hint);
        process.exitCode = 1;
    } finally {
        server.close();
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log("Open this link, sign in with shourya2026@mvsrec.edu.in, and click Allow:\n");
    console.log(authUrl);
});
