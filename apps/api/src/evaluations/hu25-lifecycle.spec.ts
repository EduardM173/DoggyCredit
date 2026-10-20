import {
  MAX_EVALUATION_RETRIES,
  computeTracking,
  effectiveIdempotencyKey,
  evaluateRetryPolicy,
  fingerprintEvaluationRequest,
  usageKeyForEvaluation,
} from "./evaluation.lifecycle.js";

const payload = {
  documentType: "CI", documentNumber: "123", name: "Ana", purpose: "PERSONAL", requestedAmount: 1000,
};

describe("HU-25 reglas de ciclo de vida", () => {
  it("misma clave en tenants distintos no colisiona", () => {
    expect(effectiveIdempotencyKey("t1", "k")).not.toBe(effectiveIdempotencyKey("t2", "k"));
  });
  it("payload distinto => fingerprint distinto", () => {
    expect(fingerprintEvaluationRequest(payload)).not.toBe(
      fingerprintEvaluationRequest({ ...payload, requestedAmount: 2000 }),
    );
  });
  it("la clave de consumo deriva de evaluationId (reintento no crea otro)", () => {
    expect(usageKeyForEvaluation("t", "e")).toBe(usageKeyForEvaluation("t", "e"));
  });
  it("COMPLETED y IN_PROGRESS no permiten reintento", () => {
    for (const status of ["COMPLETED", "IN_PROGRESS"]) {
      expect(evaluateRetryPolicy({ status, retryCount: 0, sources: [] }).allowed).toBe(false);
    }
  });
  it("INCOMPLETE con fuente UNAVAILABLE es reintentable hasta el máximo", () => {
    const sources = [{ status: "SUCCESS" }, { status: "UNAVAILABLE", errorCode: "CIRCUIT_OPEN" }];
    expect(evaluateRetryPolicy({ status: "INCOMPLETE", retryCount: 0, sources }).allowed).toBe(true);
    expect(
      evaluateRetryPolicy({ status: "INCOMPLETE", retryCount: MAX_EVALUATION_RETRIES, sources }).allowed,
    ).toBe(false);
  });
  it("NO_DATA no se reintenta", () => {
    expect(
      evaluateRetryPolicy({ status: "INCOMPLETE", retryCount: 0, sources: [{ status: "NO_DATA" }] }).allowed,
    ).toBe(false);
  });
  it("lease vencido => PROGRESS_STALLED; vigente => ACTIVE_WAIT", () => {
    const now = new Date();
    expect(computeTracking({ status: "IN_PROGRESS", leaseExpiresAt: new Date(now.getTime() - 1), retryable: false, now })).toBe("PROGRESS_STALLED");
    expect(computeTracking({ status: "IN_PROGRESS", leaseExpiresAt: new Date(now.getTime() + 5000), retryable: false, now })).toBe("ACTIVE_WAIT");
  });
});
