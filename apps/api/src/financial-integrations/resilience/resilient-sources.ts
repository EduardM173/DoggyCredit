import { Injectable, Logger } from "@nestjs/common";
import { BankMockSource, BureauMockSource } from "../public.js";
import { resilienceConfig } from "./resilience.config.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { ResilientExecutor, type ProviderResultLike } from "./resilient-executor.js";
import { ProviderMetrics } from "./provider-metrics.js";

/**
 * Única capa que reintenta (S4-OPS-03 / T09).
 * Un breaker por proveedor, en memoria y por instancia (limitación C1 de DC-148).
 * No registra CI/NIT ni payloads: solo providerCode, estado, latencia e intentos (RF-05).
 */
@Injectable()
export class ResilientSources {
  private readonly logger = new Logger(ResilientSources.name);
  readonly metrics = new ProviderMetrics();
  private readonly cfg = resilienceConfig();
  private readonly executors = new Map<string, ResilientExecutor>();

  constructor(
    private readonly bank: BankMockSource,
    private readonly bureau: BureauMockSource,
  ) {}

  /** providerId se usa solo para armar el resultado UNAVAILABLE cuando el proveedor no respondió. */
  queryBank(providerId: string | undefined, ...args: Parameters<BankMockSource["query"]>) {
    return this.run("BANK_MOCK", providerId, () => this.bank.query(...args));
  }

  queryBureau(providerId: string | undefined, ...args: Parameters<BureauMockSource["query"]>) {
    return this.run("BUREAU_MOCK", providerId, () => this.bureau.query(...args));
  }

  private async run<R extends ProviderResultLike>(
    providerCode: string,
    providerId: string | undefined,
    fn: () => Promise<R>,
  ): Promise<R> {
    const { result } = await this.executorFor(providerCode).execute(
      fn,
      (code) =>
        ({
          status: "UNAVAILABLE",
          providerId: providerId ?? "",
          errorCode: code,
          message: "El proveedor no está disponible temporalmente.",
          retryable: true,
        }) as unknown as R,
    );
    return result;
  }

  private executorFor(providerCode: string): ResilientExecutor {
    let ex = this.executors.get(providerCode);
    if (!ex) {
      const breaker = new CircuitBreaker(
        this.cfg.breaker,
        () => Date.now(),
        (from, to) => {
          this.metrics.onBreakerChange(providerCode, from, to);
          this.logger.warn(`[${providerCode}] breaker ${from} -> ${to}`);
        },
      );
      ex = new ResilientExecutor(providerCode, breaker, this.cfg.executor, {
        observer: this.metrics,
      });
      this.executors.set(providerCode, ex);
    }
    return ex;
  }
}
