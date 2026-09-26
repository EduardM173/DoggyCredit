import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";

describe("DoggyCredit API (e2e)", () => {
  let app;

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  after(async () => app?.close());

  it("GET /api/health", async () => {
    await request(app.getHttpServer())
      .get("/api/health")
      .expect(200)
      .expect({ status: "ok", service: "doggycredit-api" });
  });

  it("publishes the OpenAPI document", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs-json").expect(200);
    assert.equal(response.body.info.title, "DoggyCredit API");
  });
});
