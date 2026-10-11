import nodemailer, { type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { google } from "googleapis";

// Sends mail through either:
//  - the Gmail API with OAuth (no App Password or 2-Step Verification needed):
//      GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN  (get the token with src/lib/gmailAuth.ts)
//      MAIL_FROM must be that Gmail address, e.g. "SHOURYA'26 <you@gmail.com>"
//  - or any SMTP server: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
// With neither configured, mail is off and nothing is sent.

export type MailMessage = {
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments?: { filename: string; content: Buffer; cid?: string; contentType?: string }[];
};
export type SendMail = (message: MailMessage) => Promise<void>;

function gmailApiConfigured() {
    return Boolean(
        process.env.GMAIL_CLIENT_ID?.trim() && process.env.GMAIL_CLIENT_SECRET?.trim() && process.env.GMAIL_REFRESH_TOKEN?.trim(),
    );
}

function smtpConfigured() {
    return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

export function mailConfigured() {
    return gmailApiConfigured() || smtpConfigured();
}

function fromAddress() {
    return process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || "";
}

let gmail: ReturnType<typeof google.gmail> | undefined;

function getGmail() {
    if (!gmail) {
        const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID!.trim(), process.env.GMAIL_CLIENT_SECRET!.trim());
        auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN!.trim() });
        gmail = google.gmail({ version: "v1", auth });
    }
    return gmail;
}

// Builds the full MIME message (with the inline QR image) and sends it as the signed-in Gmail user.
async function sendWithGmailApi(message: MailMessage) {
    const raw = await new MailComposer({ from: fromAddress(), ...message }).compile().build();
    await getGmail().users.messages.send({
        userId: "me",
        requestBody: { raw: raw.toString("base64url") },
    });
}

let transporter: Transporter | undefined;

function getTransporter() {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT) || 465;
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST!.trim(),
            port,
            // Port 465 uses TLS from the start; 587 upgrades with STARTTLS.
            secure: port === 465,
            auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS!.replace(/\s+/g, "") },
            connectionTimeout: 20_000,
            greetingTimeout: 20_000,
            socketTimeout: 30_000,
        });
    }
    return transporter;
}

export const sendMail: SendMail = async (message) => {
    if (gmailApiConfigured()) return sendWithGmailApi(message);
    if (smtpConfigured()) {
        await getTransporter().sendMail({ from: fromAddress(), ...message });
        return;
    }
    throw new Error("Email isn't configured: set the GMAIL_* or SMTP_* settings");
};
