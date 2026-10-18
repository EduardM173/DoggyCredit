import { CircuitBreaker, BreakerState } from './circuit-breaker.js';

export type SourceStatus = 'SUCCESS' | 'NO_DATA' | 'UNAVAILABLE' | 'ERROR';

export interface ProviderResultLike {
  status: SourceStatus;
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface ExecutorOptions {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
  totalBudgetMs: number;
}

export interface ResilienceObserver {
  onAttempt(e: {
    providerCode: string;
    attempt: number;
    status: SourceStatus;
    latencyMs: number;
    correlationId?: string;
  }): void;
  onBreakerRejected(providerCode: string, correlationId?: string): void;
  onBreakerChange(providerCode: string, from: BreakerState, to: BreakerState): void;
}

export interface ExecutorDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  observer?: ResilienceObserver;
}

export interface ExecOutcome<R> {
  result: R;
  attempts: number;
  circuitOpen: boolean;
}

/** Clasificador único (T02). */
export function isTransient(r: ProviderResultLike): boolean {
  if (r.status === 'UNAVAILABLE') return true;
  if (r.status === 'ERROR') return r.retryable === true;
  return false;
}

export class ResilientExecutor {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly providerCode: string,
    private readonly breaker: CircuitBreaker,
    private readonly opts: ExecutorOptions,
    private readonly deps: ExecutorDeps = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
    this.random = deps.random ?? Math.random;
  }

  async execute<R extends ProviderResultLike>(
    call: () => Promise<R>,
    makeUnavailable: (code: string) => R,
    correlationId?: string,
  ): Promise<ExecOutcome<R>> {
    const start = this.now();
    let attempts = 0;
    let last: R | undefined;

    for (;;) {
      if (!this.breaker.tryAcquire()) {
        this.deps.observer?.onBreakerRejected(this.providerCode, correlationId);
        return { result: last ?? makeUnavailable('CIRCUIT_OPEN'), attempts, circuitOpen: true };
      }

      attempts++;
      const t0 = this.now();
      const r = await this.callWithTimeout(call, makeUnavailable);
      this.deps.observer?.onAttempt({
        providerCode: this.providerCode,
        attempt: attempts,
        status: r.status,
        latencyMs: this.now() - t0,
        correlationId,
      });

      if (r.status === 'SUCCESS' || r.status === 'NO_DATA') {
        this.breaker.recordSuccess();
        return { result: r, attempts, circuitOpen: false };
      }
      if (!isTransient(r)) {
        this.breaker.release();
        return { result: r, attempts, circuitOpen: false };
      }

      this.breaker.recordFailure();
      last = r;

      const retriesDone = attempts - 1;
      if (retriesDone >= this.opts.maxRetries) {
        return { result: r, attempts, circuitOpen: false };
      }
      const delay = this.computeDelay(retriesDone, r.retryAfterMs);
      if (this.now() - start + delay >= this.opts.totalBudgetMs) {
        return { result: r, attempts, circuitOpen: false };
      }
      await this.sleep(delay);
    }
  }

  /** Backoff exponencial con jitter completo: random(0, min(tope, base * factor^n)). */
  private computeDelay(retryIndex: number, retryAfterMs?: number): number {
    const cap = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * this.opts.factor ** retryIndex);
    const jittered = Math.floor(this.random() * cap);
    if (retryAfterMs && retryAfterMs > 0) {
      return Math.min(Math.max(jittered, retryAfterMs), this.opts.maxDelayMs);
    }
    return jittered;
  }

  private async callWithTimeout<R extends ProviderResultLike>(
    call: () => Promise<R>,
    makeUnavailable: (code: string) => R,
  ): Promise<R> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<R>((resolve) => {
      timer = setTimeout(() => resolve(makeUnavailable('TIMEOUT')), this.opts.timeoutMs);
    });
    try {
      return await Promise.race([call().catch(() => makeUnavailable('PROVIDER_EXCEPTION')), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
