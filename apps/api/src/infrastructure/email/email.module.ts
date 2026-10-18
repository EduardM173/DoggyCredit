import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailSender } from "./email-sender.js";
import { SmtpEmailAdapter } from "./smtp-email.adapter.js";
import { TestInbox, TestInboxEmailAdapter } from "./test-inbox-email.adapter.js";

@Module({
  providers: [
    TestInbox,
    SmtpEmailAdapter,
    TestInboxEmailAdapter,
    {
      provide: EmailSender,
      inject: [ConfigService, SmtpEmailAdapter, TestInboxEmailAdapter],
      useFactory: (
        config: ConfigService,
        smtp: SmtpEmailAdapter,
        testInbox: TestInboxEmailAdapter,
      ): EmailSender => (config.getOrThrow<string>("EMAIL_TRANSPORT") === "test_inbox" ? testInbox : smtp),
    },
  ],
  exports: [EmailSender, TestInbox],
})
export class EmailModule {}
