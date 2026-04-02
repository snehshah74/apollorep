// Wraps Resend email delivery with consistent logging and error handling.
// Used by both the orchestrator (autonomous sends) and approval server (approved sends).
// Never throws — callers get a boolean so pipeline never crashes on email failure.

import { Resend } from "resend";
import * as dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY || "");

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
    const from = process.env.FROM_EMAIL || "apollorep@yourdomain.com";

    const result = await resend.emails.send({
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
