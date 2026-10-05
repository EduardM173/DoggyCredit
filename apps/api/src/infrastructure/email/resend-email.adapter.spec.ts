import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { ResendEmailAdapter } from "./resend-email.adapter.js";

describe("ResendEmailAdapter (no network)", () => {
  const message = {
    to: "recipient@example.test",
    subject: "Confirmar",
    html: "<p>token-not-for-logs</p>",
    text: "token-not-for-logs",
    idempotencyKey: "request/test/token",
  };
  const config = new ConfigService({
    RESEND_API_KEY: "re_fake_test_key",
    RESEND_FROM_EMAIL: "sender@example.test",
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it("passes the configured sender and stable idempotency key", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "provider-test" }), { status: 200 }));
    await new ResendEmailAdapter(config).send(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(message.idempotencyKey);
    expect(JSON.parse(String(options?.body))).toMatchObject({ from: "sender@example.test", to: message.to });
  });
  it("never logs or propagates provider error payloads", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "validation_error",
          message: "token-not-for-logs re_fake_test_key",
          statusCode: 403,
        }),
        { status: 403 },
      ),
    );
    const logs = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(new ResendEmailAdapter(config).send(message)).rejects.toThrow("Email delivery unavailable");
    expect(logs).not.toHaveBeenCalled();
  });
  it("does not call a provider without credentials", async () => {
    const network = jest.spyOn(globalThis, "fetch");
    await expect(new ResendEmailAdapter(new ConfigService({})).send(message)).rejects.toThrow(
      "Email delivery unavailable",
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("bounds the wait without a real timeout or network request", async () => {
    jest.useFakeTimers();
    jest.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const result = expect(new ResendEmailAdapter(config).send(message)).rejects.toThrow(
      "Email delivery unavailable",
    );
    await jest.advanceTimersByTimeAsync(8000);
    await result;
  });
});
