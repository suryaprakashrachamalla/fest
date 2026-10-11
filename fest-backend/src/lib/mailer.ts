import nodemailer, { type Transporter } from "nodemailer";

// Sends mail through any SMTP server, e.g. Gmail with an App Password:
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=you@gmail.com  SMTP_PASS=<16-letter app password>
//   MAIL_FROM="SHOURYA'26 <you@gmail.com>"
// Without SMTP_HOST, SMTP_USER and SMTP_PASS, mail is off and nothing is sent.

export type MailMessage = {
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments?: { filename: string; content: Buffer; cid?: string; contentType?: string }[];
};
export type SendMail = (message: MailMessage) => Promise<void>;

export function mailConfigured() {
    return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
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
    if (!mailConfigured()) throw new Error("Email isn't configured: set SMTP_HOST, SMTP_USER and SMTP_PASS");
    await getTransporter().sendMail({
        from: process.env.MAIL_FROM?.trim() || process.env.SMTP_USER!.trim(),
        ...message,
    });
};
