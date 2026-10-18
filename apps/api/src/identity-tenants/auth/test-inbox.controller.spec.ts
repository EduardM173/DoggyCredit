import { ConfigService } from "@nestjs/config";
import { TestInbox, TestInboxEmailAdapter } from "../../infrastructure/email/test-inbox-email.adapter.js";
import { TestInboxController } from "./test-inbox.controller.js";

describe("TestInboxController", () => {
  it("only exposes messages when the explicit local test transport is active", async () => {
    const inbox = new TestInbox();
    await new TestInboxEmailAdapter(inbox).send({
      to: "demo@example.test",
      subject: "Invitación de prueba",
      text: "Mensaje de prueba",
      html: "<p>Mensaje de prueba</p>",
      idempotencyKey: "invitation/demo/1",
    });

    expect(new TestInboxController(new ConfigService({ EMAIL_TRANSPORT: "test_inbox" }), inbox).list()).toEqual(
      expect.objectContaining({ enabled: true, messages: [expect.objectContaining({ subject: "Invitación de prueba" })] }),
    );
    expect(new TestInboxController(new ConfigService({ EMAIL_TRANSPORT: "smtp" }), inbox).list()).toEqual({
      enabled: false,
      messages: [],
    });
  });
});
