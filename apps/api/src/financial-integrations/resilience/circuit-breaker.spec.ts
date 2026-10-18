import { CircuitBreaker, BreakerOptions } from './circuit-breaker.js';

const opts: BreakerOptions = {
  consecutiveFailures: 5,
  failureRatio: 0.5,
  minCalls: 10,
  windowMs: 60000,
  openDurationMs: 30000,
};

const setup = () => {
  let t = 0;
  const changes: string[] = [];
  const b = new CircuitBreaker(opts, () => t, (f, to) => changes.push(`${f}->${to}`));
  return { b, advance: (ms: number) => (t += ms), changes };
};

describe('CircuitBreaker', () => {
  it('abre con 5 fallos consecutivos', () => {
    const { b } = setup();
    for (let i = 0; i < 4; i++) b.recordFailure();
    expect(b.getState()).toBe('CLOSED');
    b.recordFailure();
    expect(b.getState()).toBe('OPEN');
  });

  it('abre con >=50% de fallos y minimo 10 llamadas', () => {
    const { b } = setup();
    [true, false, false, false, false, true, false, false, false, false].forEach((ok) =>
      ok ? b.recordSuccess() : b.recordFailure(),
    );
    expect(b.getState()).toBe('OPEN');
  });

  it('en OPEN rechaza llamadas', () => {
    const { b } = setup();
    for (let i = 0; i < 5; i++) b.recordFailure();
    expect(b.tryAcquire()).toBe(false);
  });

  it('a los 30s pasa a HALF_OPEN y permite UNA sola sonda', () => {
    const { b, advance } = setup();
    for (let i = 0; i < 5; i++) b.recordFailure();
    advance(30000);
    expect(b.getState()).toBe('HALF_OPEN');
    expect(b.tryAcquire()).toBe(true);
    expect(b.tryAcquire()).toBe(false);
  });

  it('sonda exitosa -> CLOSED', () => {
    const { b, advance } = setup();
    for (let i = 0; i < 5; i++) b.recordFailure();
    advance(30000);
    b.tryAcquire();
    b.recordSuccess();
    expect(b.getState()).toBe('CLOSED');
    expect(b.tryAcquire()).toBe(true);
  });

  it('sonda fallida -> OPEN otra vez y espera otros 30s', () => {
    const { b, advance } = setup();
    for (let i = 0; i < 5; i++) b.recordFailure();
    advance(30000);
    b.tryAcquire();
    b.recordFailure();
    expect(b.getState()).toBe('OPEN');
    advance(29999);
    expect(b.getState()).toBe('OPEN');
    advance(1);
    expect(b.getState()).toBe('HALF_OPEN');
  });

  it('respuestas validas (NO_DATA) no abren el breaker', () => {
    const { b } = setup();
    for (let i = 0; i < 50; i++) b.recordSuccess();
    expect(b.getState()).toBe('CLOSED');
  });
});
