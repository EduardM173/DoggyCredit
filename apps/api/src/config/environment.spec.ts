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
});
