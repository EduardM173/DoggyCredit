import { jest } from '@jest/globals';
import { CircuitBreaker } from './circuit-breaker.js';
import { ResilientExecutor, ProviderResultLike, ExecutorOptions } from './resilient-executor.js';

type R = ProviderResultLike & { code?: string };

const exOpts: ExecutorOptions = {
  timeoutMs: 5000,
  maxRetries: 3,
  baseDelayMs: 500,
  factor: 2,
  maxDelayMs: 8000,
  totalBudgetMs: 20000,
};
const brOpts = { consecutiveFailures: 5, failureRatio: 0.5, minCalls: 10, windowMs: 60000, openDurationMs: 30000 };
const unavailable = (code: string): R => ({ status: 'UNAVAILABLE', retryable: true, code });

const setup = (overrides: Partial<ExecutorOptions> = {}, breakerOverrides = {}) => {
  let t = 0;
  const sleeps: number[] = [];
  const now = () => t;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    t += ms;
  };
  const breaker = new CircuitBreaker({ ...brOpts, ...breakerOverrides }, now);
  const ex = new ResilientExecutor('BUREAU_MOCK', breaker, { ...exOpts, ...overrides }, { now, sleep, random: () => 1 });
  return { ex, breaker, sleeps, advance: (ms: number) => (t += ms), clock: () => t };
};

describe('ResilientExecutor', () => {
  it('T03: maximo 3 reintentos (4 llamadas) con backoff exponencial 500/1000/2000', async () => {
    const { ex, sleeps } = setup({}, { consecutiveFailures: 100 });
    const call = jest.fn(async (): Promise<R> => ({ status: 'UNAVAILABLE', retryable: true }));
    const out = await ex.execute(call, unavailable);
    expect(call).toHaveBeenCalledTimes(4);
    expect(out.result.status).toBe('UNAVAILABLE');
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it('T03: nunca supera el presupuesto total de 20 s', async () => {
    const { ex, clock } = setup(
      { maxRetries: 10, factor: 1, baseDelayMs: 8000, maxDelayMs: 8000 },
      { consecutiveFailures: 100 },
    );
    const call = jest.fn(async (): Promise<R> => ({ status: 'UNAVAILABLE', retryable: true }));
    await ex.execute(call, unavailable);
    expect(call).toHaveBeenCalledTimes(3);
    expect(clock()).toBeLessThanOrEqual(20000);
  });

  it('T06: NO_DATA no se reintenta', async () => {
    const { ex } = setup();
    const call = jest.fn(async (): Promise<R> => ({ status: 'NO_DATA' }));
    await ex.execute(call, unavailable);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('T06: ERROR con retryable=false no se reintenta ni cuenta al breaker', async () => {
    const { ex, breaker } = setup();
    const call = jest.fn(async (): Promise<R> => ({ status: 'ERROR', retryable: false }));
    for (let i = 0; i < 10; i++) await ex.execute(call, unavailable);
    expect(call).toHaveBeenCalledTimes(10);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('ERROR con retryable=true si se reintenta', async () => {
    const { ex } = setup({}, { consecutiveFailures: 100 });
    const call = jest.fn(async (): Promise<R> => ({ status: 'ERROR', retryable: true }));
    await ex.execute(call, unavailable);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it('respeta retryAfterMs (429) con tope', async () => {
    const { ex, sleeps } = setup({ maxRetries: 1 }, { consecutiveFailures: 100 });
    const call = jest.fn(async (): Promise<R> => ({ status: 'UNAVAILABLE', retryable: true, retryAfterMs: 3000 }));
    await ex.execute(call, unavailable);
    expect(sleeps).toEqual([3000]);
  });

  it('T01: corta una llamada lenta por timeout', async () => {
    const { ex } = setup({ timeoutMs: 20, maxRetries: 0 });
    const call = jest.fn(() => new Promise<R>(() => {}));
    const out = await ex.execute(call, unavailable);
    expect(out.result).toMatchObject({ status: 'UNAVAILABLE', code: 'TIMEOUT' });
  });

  it('T02: una excepcion se convierte en UNAVAILABLE', async () => {
    const { ex } = setup({ maxRetries: 0 });
    const call = jest.fn(async (): Promise<R> => {
      throw new Error('boom');
    });
    const out = await ex.execute(call, unavailable);
    expect(out.result).toMatchObject({ status: 'UNAVAILABLE', code: 'PROVIDER_EXCEPTION' });
  });

  it('caida persistente: el breaker abre y luego responde rapido SIN llamar al proveedor', async () => {
    const { ex, breaker } = setup();
    const call = jest.fn(async (): Promise<R> => ({ status: 'UNAVAILABLE', retryable: true }));
    await ex.execute(call, unavailable);
    await ex.execute(call, unavailable);
    expect(breaker.getState()).toBe('OPEN');
    const callsBefore = call.mock.calls.length;
    const out = await ex.execute(call, unavailable);
    expect(call.mock.calls.length).toBe(callsBefore);
    expect(out.circuitOpen).toBe(true);
    expect(out.result.status).toBe('UNAVAILABLE');
  });

  it('recuperacion: tras 30 s hay 1 sonda y si responde bien vuelve a CLOSED', async () => {
    const { ex, breaker, advance } = setup();
    const failing = jest.fn(async (): Promise<R> => ({ status: 'UNAVAILABLE', retryable: true }));
    await ex.execute(failing, unavailable);
    await ex.execute(failing, unavailable);
    expect(breaker.getState()).toBe('OPEN');
    advance(30000);
    const ok = jest.fn(async (): Promise<R> => ({ status: 'SUCCESS' }));
    const out = await ex.execute(ok, unavailable);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(out.result.status).toBe('SUCCESS');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('NO_DATA repetido no abre el breaker', async () => {
    const { ex, breaker } = setup();
    const call = jest.fn(async (): Promise<R> => ({ status: 'NO_DATA' }));
    for (let i = 0; i < 30; i++) await ex.execute(call, unavailable);
    expect(call).toHaveBeenCalledTimes(30);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('Bank sigue operando aunque el Buro este caido (breakers independientes)', async () => {
    const bureau = setup();
    const bank = setup();
    const down = jest.fn(async (): Promise<R> => ({ status: 'UNAVAILABLE', retryable: true }));
    await bureau.ex.execute(down, unavailable);
    await bureau.ex.execute(down, unavailable);
    expect(bureau.breaker.getState()).toBe('OPEN');
    const up = jest.fn(async (): Promise<R> => ({ status: 'SUCCESS' }));
    const out = await bank.ex.execute(up, unavailable);
    expect(out.result.status).toBe('SUCCESS');
    expect(bank.breaker.getState()).toBe('CLOSED');
  });
});
