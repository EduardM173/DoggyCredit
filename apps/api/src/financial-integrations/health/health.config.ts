import { PROPOSED_HEALTH_CONFIG, type HealthConfig } from "./provider-health.service.js";

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** HU-23 (CA-23.14): ventana, caducidad y umbrales configurables. Valores por defecto = PROPUESTO. */
export function healthConfig(env: NodeJS.ProcessEnv = process.env): HealthConfig {
  const p = PROPOSED_HEALTH_CONFIG;
  return {
    windowSeconds: num(env.HEALTH_WINDOW_SECONDS, p.windowSeconds),
    signalTtlSeconds: num(env.HEALTH_SIGNAL_TTL_SECONDS, p.signalTtlSeconds),
    minSamples: Math.floor(num(env.HEALTH_MIN_SAMPLES, p.minSamples)),
    failureRatioThreshold: num(env.HEALTH_FAILURE_RATIO, p.failureRatioThreshold),
  };
}
