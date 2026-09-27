import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { EmailSender, type EmailMessage } from "./email-sender.js";

@Injectable()
export class ResendEmailAdapter extends EmailSender {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async send(message: EmailMessage): Promise<void> {
    const key = this.config.get<string>("RESEND_API_KEY");
    const from = this.config.get<string>("RESEND_FROM_EMAIL");
    if (!key || !from) throw new Error("Email delivery unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const client = new Resend(key);
      // Resend 6.30 logs raw provider errors in development. Suppress only this instance.
      // The pinned SDK version and adapter tests guard this internal compatibility hook.
      Object.defineProperty(client, "logError", { value: () => undefined });
      const result = await Promise.race([
        client.emails.send(
          {
            from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          },
          { idempotencyKey: message.idempotencyKey },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Email delivery timeout")), 8000);
        }),
      ]);
      if (result.error || !result.data?.id) throw new Error("Email delivery unavailable");
    } catch {
      // Never propagate SDK errors: they can contain recipient, payload or credentials.
      throw new Error("Email delivery unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
