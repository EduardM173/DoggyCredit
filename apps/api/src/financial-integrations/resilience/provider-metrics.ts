import { BreakerState } from './circuit-breaker.js';
import { ResilienceObserver, SourceStatus } from './resilient-executor.js';

interface Bucket {
  calls: number;
  retries: number;
  rejected: number;
  byStatus: Record<string, number>;
  latencies: number[];
  breaker: BreakerState;
  stateChanges: number;
}

const pct = (arr: number[], p: number): number | null => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

/** Solo guarda providerCode, estado, latencia y contadores. NUNCA datos del sujeto (ver RF-05). */
export class ProviderMetrics implements ResilienceObserver {
  private data = new Map<string, Bucket>();

  private bucket(code: string): Bucket {
    let b = this.data.get(code);
    if (!b) {
      b = { calls: 0, retries: 0, rejected: 0, byStatus: {}, latencies: [], breaker: 'CLOSED', stateChanges: 0 };
      this.data.set(code, b);
    }
    return b;
  }

  onAttempt(e: { providerCode: string; attempt: number; status: SourceStatus; latencyMs: number }): void {
    const b = this.bucket(e.providerCode);
    b.calls++;
    if (e.attempt > 1) b.retries++;
    b.byStatus[e.status] = (b.byStatus[e.status] ?? 0) + 1;
    b.latencies.push(e.latencyMs);
    if (b.latencies.length > 1000) b.latencies.shift();
  }

  onBreakerRejected(code: string): void {
    this.bucket(code).rejected++;
  }

  onBreakerChange(code: string, _from: BreakerState, to: BreakerState): void {
    const b = this.bucket(code);
    b.breaker = to;
    b.stateChanges++;
  }

  snapshot() {
    return [...this.data.entries()].map(([providerCode, b]) => ({
      providerCode,
      calls: b.calls,
      retries: b.retries,
      rejectedByBreaker: b.rejected,
      byStatus: b.byStatus,
      breaker: b.breaker,
      stateChanges: b.stateChanges,
      latencyMs: { p50: pct(b.latencies, 50), p95: pct(b.latencies, 95), p99: pct(b.latencies, 99) },
    }));
  }
}
