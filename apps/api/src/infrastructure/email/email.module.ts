import { Module } from "@nestjs/common";
import { EmailSender } from "./email-sender.js";
import { ResendEmailAdapter } from "./resend-email.adapter.js";

@Module({ providers: [{ provide: EmailSender, useClass: ResendEmailAdapter }], exports: [EmailSender] })
export class EmailModule {}
