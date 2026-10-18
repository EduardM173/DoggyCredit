import { TestInbox, TestInboxEmailAdapter } from "./test-inbox-email.adapter.js";

describe("TestInboxEmailAdapter", () => {
  it("stores a local demo message and explicitly reports that it was not sent by SMTP", async () => {
    const inbox = new TestInbox();
    const result = await new TestInboxEmailAdapter(inbox).send({
      to: "demo@example.test",
      subject: "Confirmar correo",
      text: "https://demo.test/verificar-correo?token=one-time-token",
      html: "<a href=\"https://demo.test/verificar-correo?token=one-time-token\">Confirmar</a>",
      idempotencyKey: "verification/demo/1",
    });

    expect(result).toEqual({ channel: "TEST_INBOX" });
    const [message] = inbox.list();
    expect(message).toEqual(
      expect.objectContaining({
        to: "demo@example.test",
        subject: "Confirmar correo",
        text: expect.stringContaining("one-time-token"),
      }),
    );
    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(message.receivedAt))).toBe(false);
  });
});
