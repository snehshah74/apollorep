// Wraps Resend email delivery with consistent logging and error handling.
// Used by both the orchestrator (autonomous sends) and approval server (approved sends).
// Never throws — callers get a boolean so pipeline never crashes on email failure.

import { Resend } from "resend";
import * as dotenv from "dotenv";

dotenv.config();

// Lazy-initialized — avoids crashing on startup if key is missing
let _resend: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  actionId: string
): Promise<boolean> {
  try {
    const resend = getResend();
    if (!resend) {
      console.warn(`[${timestamp()}] [EmailSender] RESEND_API_KEY not set — skipping send | actionId: ${actionId}`);
      return false;
    }
    const from = process.env.FROM_EMAIL || "apollorep@yourdomain.com";

    const result = await resend!.emails.send({
      from,
      to,
      subject,
      html: htmlBody,
    });

    if (result.error) {
      console.error(
        `[${timestamp()}] [EmailSender] Resend API error | actionId: ${actionId}`,
        result.error
      );
      return false;
    }

    console.log(
      `[${timestamp()}] [EmailSender] Email sent to ${to} | subject: ${subject} | actionId: ${actionId}`
    );
    return true;
  } catch (error) {
    console.error(
      `[${timestamp()}] [EmailSender] Unexpected error sending email | actionId: ${actionId}:`,
      error
    );
    return false;
  }
}
