import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EmailSender, type EmailMessage } from "./email-sender.js";

export type TestInboxMessage = {
  id: string;
  receivedAt: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Volatile, local-only mailbox for demos. It is never selected in production. */
@Injectable()
export class TestInbox {
  private readonly messages: TestInboxMessage[] = [];

  receive(message: EmailMessage) {
    const stored: TestInboxMessage = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    };
    this.messages.unshift(stored);
    this.messages.splice(100);
  }

  list() {
    return this.messages.map((message) => ({ ...message }));
  }
}

@Injectable()
export class TestInboxEmailAdapter extends EmailSender {
  constructor(private readonly inbox: TestInbox) {
    super();
  }

  async send(message: EmailMessage) {
    this.inbox.receive(message);
    return { channel: "TEST_INBOX" as const };
  }
}
