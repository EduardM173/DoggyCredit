import { environmentValidationSchema } from "./environment.js";

describe("environmentValidationSchema", () => {
  it("reports every missing required variable", () => {
    const { error } = environmentValidationSchema.validate({}, { abortEarly: false });

    expect(error?.message).toContain("DATABASE_URL is required");
    expect(error?.message).toContain("WEB_ORIGIN is required");
  });

  it("accepts a valid local configuration", () => {
    const { error } = environmentValidationSchema.validate({
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/doggycredit",
      WEB_ORIGIN: "http://localhost:5173",
      API_PORT: 3000,
    });

    expect(error).toBeUndefined();
  });
  it("requires email configuration and HTTPS in production", () => {
    const { error } = environmentValidationSchema.validate(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://postgres:password@localhost:5432/doggycredit",
        WEB_ORIGIN: "https://example.test",
        PUBLIC_APP_URL: "http://example.test",
      },
      { abortEarly: false },
    );
    expect(error?.message).toContain("RESEND_API_KEY");
    expect(error?.message).toContain("RESEND_FROM_EMAIL");
    expect(error?.message).toContain("PUBLIC_APP_URL");
  });
  it("rejects unsafe URLs and nonpositive durations", () => {
    const { error } = environmentValidationSchema.validate(
      {
        DATABASE_URL: "postgresql://postgres:password@localhost:5432/doggycredit",
        WEB_ORIGIN: "http://localhost:5173",
        PUBLIC_APP_URL: "https://user:password@example.test/?token=abc",
        EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: 0,
        EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: 0,
      },
      { abortEarly: false },
    );
    expect(error?.message).toContain("PUBLIC_APP_URL");
    expect(error?.message).toContain("EMAIL_VERIFICATION_TOKEN_TTL_MINUTES");
    expect(error?.message).toContain("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS");
  });
});
