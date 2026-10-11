// One-time setup: connects the Gmail account that sends entry tickets through the Gmail API.
//
//   bun src/lib/gmailAuth.ts <path to the OAuth client JSON> [env file, default .env.production]
//
// Opens a Google sign-in link; after you allow "Send email on your behalf", the refresh token and
// sender are written into the env file (never printed). Needs, in Google Cloud for that project:
// the Gmail API enabled, and http://localhost:53682/oauth2callback as an authorized redirect URI.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];

const [clientFile, envFileArg] = process.argv.slice(2);
if (!clientFile) {
    console.error("Usage: bun src/lib/gmailAuth.ts <oauth-client.json> [env file]");
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
        const email = tokens.id_token
            ? (JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email
            : undefined;
        if (!email) throw new Error("Couldn't read the Gmail address from the sign-in");
        writeEnv({
            GMAIL_CLIENT_ID: client.client_id,
            GMAIL_CLIENT_SECRET: client.client_secret,
            GMAIL_REFRESH_TOKEN: tokens.refresh_token,
            MAIL_FROM: `SHOURYA'26 <${email}>`,
        });
        res.writeHead(200, { "Content-Type": "text/html" }).end(
            `<p style="font-family:sans-serif">Connected <b>${email}</b>. You can close this tab.</p>`,
        );
        console.log(`Connected ${email}. Saved GMAIL_* settings and MAIL_FROM in ${envFile}`);
    } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" }).end(String(error instanceof Error ? error.message : error));
        console.error("Failed:", error instanceof Error ? error.message : error);
        process.exitCode = 1;
    } finally {
        server.close();
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log("Open this link, sign in with the Gmail that should send the tickets, and click Allow:\n");
    console.log(authUrl);
});
