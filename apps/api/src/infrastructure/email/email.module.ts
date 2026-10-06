import { Module } from "@nestjs/common";
import { EmailSender } from "./email-sender.js";
import { SmtpEmailAdapter } from "./smtp-email.adapter.js";

@Module({ providers: [{ provide: EmailSender, useClass: SmtpEmailAdapter }], exports: [EmailSender] })
export class EmailModule {}
