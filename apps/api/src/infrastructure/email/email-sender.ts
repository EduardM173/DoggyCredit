export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<void>;
}
