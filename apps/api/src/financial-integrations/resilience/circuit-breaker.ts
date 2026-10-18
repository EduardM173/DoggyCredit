export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerOptions {
  consecutiveFailures: number;
  failureRatio: number;
  minCalls: number;
  windowMs: number;
  openDurationMs: number;
}

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private consecutive = 0;
  private events: { t: number; ok: boolean }[] = [];
  private openedAt = 0;
  private probeInFlight = false;

  constructor(
    private readonly opts: BreakerOptions,
    private readonly now: () => number = () => Date.now(),
    private readonly onStateChange?: (from: BreakerState, to: BreakerState) => void,
  ) {}

  getState(): BreakerState {
    this.refresh();
    return this.state;
  }

  /** true = se puede llamar al proveedor. En HALF_OPEN solo deja pasar 1 sonda. */
  tryAcquire(): boolean {
    this.refresh();
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') return false;
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  /** SUCCESS o NO_DATA (respuesta válida). */
  recordSuccess(): void {
    if (this.state === 'OPEN') return;
    if (this.state === 'HALF_OPEN') {
      this.events = [];
      this.consecutive = 0;
      this.probeInFlight = false;
      this.transition('CLOSED');
      return;
    }
    this.events.push({ t: this.now(), ok: true });
    this.consecutive = 0;
  }

  /** Fallo transitorio (UNAVAILABLE, timeout, ERROR retryable). */
  recordFailure(): void {
    if (this.state === 'OPEN') return;
    if (this.state === 'HALF_OPEN') {
      this.probeInFlight = false;
      this.open();
      return;
    }
    this.events.push({ t: this.now(), ok: false });
    this.consecutive++;
    this.prune();
    const failures = this.events.filter((e) => !e.ok).length;
    const total = this.events.length;
    if (
      this.consecutive >= this.opts.consecutiveFailures ||
      (total >= this.opts.minCalls && failures / total >= this.opts.failureRatio)
    ) {
      this.open();
    }
  }

  /** Error permanente: no cuenta a favor ni en contra; libera la sonda si la había. */
  release(): void {
    this.probeInFlight = false;
  }

  private open(): void {
    this.openedAt = this.now();
    this.transition('OPEN');
  }

  private refresh(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.opts.openDurationMs) {
      this.probeInFlight = false;
      this.transition('HALF_OPEN');
    }
  }

  private prune(): void {
    const limit = this.now() - this.opts.windowMs;
    this.events = this.events.filter((e) => e.t >= limit);
  }

  private transition(to: BreakerState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.onStateChange?.(from, to);
  }
}
