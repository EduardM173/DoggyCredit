import { ConfigService } from "@nestjs/config";
import { ContractingAccessService } from "./contracting-access.service.js";

function build(transport: string, credential: Record<string, unknown> | null) {
  const findFirst = async () => credential;
  const db = { client: { contractingCredential: { findFirst } } };
  const requests = { approved: async () => ({}) };
  const service = new ContractingAccessService(
    db as never,
    requests as never,
    new ConfigService({ EMAIL_TRANSPORT: transport }),
    {} as never,
  );
  return service;
}

const sent = {
  sentAt: new Date("2026-10-18T10:00:00Z"),
  revokedAt: null,
  nextSendAttemptAt: null,
  sendLockedAt: null,
  lastSendErrorCode: null,
};

describe("ContractingAccessService.emailStatus - canal de entrega (S4-HF-04)", () => {
  it("informa TEST_INBOX cuando el mensaje solo quedó en la bandeja simulada", async () => {
    await expect(build("test_inbox", sent).emailStatus("r1")).resolves.toMatchObject({
      delivery: "SENT",
      channel: "TEST_INBOX",
    });
  });

  it("informa SMTP cuando el transporte real aceptó el mensaje", async () => {
    await expect(build("smtp", sent).emailStatus("r1")).resolves.toMatchObject({
      delivery: "SENT",
      channel: "SMTP",
    });
  });

  it("no declara canal si el mensaje no fue entregado", async () => {
    const failed = { ...sent, sentAt: null, lastSendErrorCode: "EMAIL_REJECTED" };
    await expect(build("test_inbox", failed).emailStatus("r1")).resolves.toMatchObject({
      delivery: "FAILED",
      channel: null,
    });
    const queued = { ...failed, nextSendAttemptAt: new Date() };
    await expect(build("smtp", queued).emailStatus("r1")).resolves.toMatchObject({
      delivery: "QUEUED",
      channel: null,
    });
  });

  it("no filtra el enlace ni el hash del token", async () => {
    const body = JSON.stringify(await build("test_inbox", sent).emailStatus("r1"));
    expect(body).not.toMatch(/token|contratacion/i);
  });
});
