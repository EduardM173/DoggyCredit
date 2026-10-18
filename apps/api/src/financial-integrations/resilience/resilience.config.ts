const n = (key: string, def: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

export const resilienceConfig = () => ({
  executor: {
    timeoutMs: n('PROVIDER_TIMEOUT_MS', 5000),
    maxRetries: n('PROVIDER_MAX_RETRIES', 3),
    baseDelayMs: n('PROVIDER_BACKOFF_BASE_MS', 500),
    factor: 2,
    maxDelayMs: n('PROVIDER_BACKOFF_MAX_MS', 8000),
    totalBudgetMs: n('PROVIDER_RETRY_BUDGET_MS', 20000),
  },
  breaker: {
    consecutiveFailures: 5,
    failureRatio: 0.5,
    minCalls: 10,
    windowMs: 60000,
    openDurationMs: 30000,
  },
});
