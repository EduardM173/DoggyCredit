import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports the API as available", () => {
    const controller = new HealthController();

    expect(controller.status()).toEqual({ status: "ok", service: "doggycredit-api" });
  });
});
