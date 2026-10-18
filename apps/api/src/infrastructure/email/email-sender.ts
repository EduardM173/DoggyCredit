export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export type EmailDeliveryChannel = "SMTP" | "TEST_INBOX";

export interface EmailDeliveryReceipt {
  channel: EmailDeliveryChannel;
}

export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<EmailDeliveryReceipt>;
}

export class EmailDeliveryError extends Error {
  constructor(public readonly retryable: boolean) {
    super("Email delivery unavailable");
  }
}
