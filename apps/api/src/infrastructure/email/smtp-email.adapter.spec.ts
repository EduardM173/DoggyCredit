import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";
import { SmtpEmailAdapter } from "./smtp-email.adapter.js";

describe("SmtpEmailAdapter (no network)", () => {
  const message = {
    to: "recipient@example.test",
    subject: "Confirmar",
    html: "<p>token-not-for-logs</p>",
    text: "token-not-for-logs",
    idempotencyKey: "request/test/token",
  };
  const config = new ConfigService({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    SMTP_USER: "sender@gmail.com",
    SMTP_PASSWORD: "app-password",
    SMTP_FROM_EMAIL: "sender@gmail.com",
  });

  afterEach(() => jest.restoreAllMocks());

  it("sends the configured message over authenticated TLS SMTP", async () => {
    const sendMail = jest.fn(async () => ({ accepted: [message.to], rejected: [] }));
    const close = jest.fn();
    const createTransport = jest
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail, close } as never);

    await new SmtpEmailAdapter(config).send(message);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: "sender@gmail.com", pass: "app-password" },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "sender@gmail.com", to: message.to, subject: message.subject }),
    );
    expect(close).toHaveBeenCalled();
  });

  it("does not connect when local SMTP credentials are absent", async () => {
    const createTransport = jest.spyOn(nodemailer, "createTransport");
    await expect(new SmtpEmailAdapter(new ConfigService({})).send(message)).rejects.toThrow(
      "Email delivery unavailable",
    );
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("classifies transient SMTP failures for the existing retry workflow", async () => {
    jest.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: jest.fn(async () => {
        throw Object.assign(new Error("private SMTP response"), { responseCode: 451 });
      }),
      close: jest.fn(),
    } as never);
    try {
      await new SmtpEmailAdapter(config).send(message);
      throw new Error("expected delivery failure");
    } catch (error) {
      expect(error).toMatchObject({ retryable: true });
      expect((error as Error).message).toBe("Email delivery unavailable");
    }
  });

  it("does not expose authentication or recipient errors", async () => {
    jest.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: jest.fn(async () => {
        throw Object.assign(new Error("private recipient response"), { code: "EAUTH" });
      }),
      close: jest.fn(),
    } as never);
    try {
      await new SmtpEmailAdapter(config).send(message);
      throw new Error("expected delivery failure");
    } catch (error) {
      expect(error).toMatchObject({ retryable: false });
      expect((error as Error).message).toBe("Email delivery unavailable");
    }
  });
});
