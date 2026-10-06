import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";
import { EmailDeliveryError, EmailSender, type EmailMessage } from "./email-sender.js";

const transientCodes = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ESOCKET",
  "ETIMEDOUT",
]);

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const smtpError = error as { code?: unknown; responseCode?: unknown };
  return (
    (typeof smtpError.code === "string" && transientCodes.has(smtpError.code)) ||
    (typeof smtpError.responseCode === "number" &&
      smtpError.responseCode >= 400 &&
      smtpError.responseCode < 500)
  );
}

@Injectable()
export class SmtpEmailAdapter extends EmailSender {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(message: EmailMessage): Promise<void> {
    const host = this.config.get<string>("SMTP_HOST");
    const user = this.config.get<string>("SMTP_USER");
    const password = this.config.get<string>("SMTP_PASSWORD");
    const from = this.config.get<string>("SMTP_FROM_EMAIL");
    if (!host || !user || !password || !from) throw new EmailDeliveryError(false);

    const transport = nodemailer.createTransport({
      host,
      port: this.config.get<number>("SMTP_PORT", 465),
      secure: this.config.get<boolean>("SMTP_SECURE", true),
      auth: { user, pass: password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });

    try {
      const result = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          "X-DoggyCredit-Delivery-Key": createHash("sha256").update(message.idempotencyKey).digest("hex"),
        },
      });
      if (!result.accepted.length || result.rejected.length) throw new EmailDeliveryError(false);
    } catch (error) {
      // SMTP errors can contain recipients, message content or credentials.
      throw error instanceof EmailDeliveryError ? error : new EmailDeliveryError(isRetryable(error));
    } finally {
      transport.close();
    }
  }
}
