import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ConflictException, GoneException, Injectable, NotFoundException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  PaymentProvider,
  type CheckoutInput,
  type DemoResult,
  type ProviderPaymentEvent,
} from "./payment-provider.js";
import type { MockPaymentCheckout, Prisma } from "../../generated/prisma/client.js";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }
  private enabled() {
    if (this.config.get("PAYMENT_PROVIDER") !== "mock") throw new NotFoundException();
  }
  async createCheckout(input: CheckoutInput) {
    this.enabled();
    const providerReference = `mock_${input.paymentId}`;
    const saved = await this.prisma.mockPaymentCheckout.upsert({
      where: { providerReference },
      update: {},
      create: {
        providerReference,
        reference: input.reference,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
      },
    });
    if (
      !saved.amount.equals(input.amount) ||
      saved.currency !== input.currency ||
      saved.method !== input.method ||
      saved.reference !== input.reference
    )
      throw new ConflictException("La inicialización no coincide con el intento original.");
    return { providerReference };
  }
  async rotateCheckout(providerReference: string) {
    this.enabled();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>("MOCK_PAYMENT_CHECKOUT_TTL_MINUTES") * 60000,
    );
    const result = await this.prisma.mockPaymentCheckout.updateMany({
      where: { providerReference, result: null, method: { in: ["QR", "CARD"] } },
      data: { tokenHash: digest(token), expiresAt },
    });
    if (result.count !== 1) throw new ConflictException("El checkout ya terminó o no admite enlace de pago.");
    const url = new URL(
      "/doggypay-demo",
      this.config.get<string>("MOCK_PAYMENT_PUBLIC_URL") || this.config.getOrThrow<string>("PUBLIC_APP_URL"),
    );
    url.hash = `token=${token}`;
    return { checkoutUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }
  private async checkout(token: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    this.enabled();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException("Checkout no disponible.");
    const row = await client.mockPaymentCheckout.findUnique({ where: { tokenHash: digest(token) } });
    if (!row) throw new NotFoundException("Checkout no disponible.");
    if (!row.expiresAt || row.expiresAt <= new Date()) {
      this.logger.warn("Expired mock checkout rejected");
      throw new GoneException("El checkout venció. Genera otro desde DoggyCredit.");
    }
    return row;
  }
  async describeCheckout(token: string) {
    const row = await this.checkout(token);
    return {
      reference: row.reference,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      method: row.method,
      status: row.result ?? "PENDING",
      expiresAt: row.expiresAt!.toISOString(),
    };
  }
  private event(row: MockPaymentCheckout): ProviderPaymentEvent {
    if (!row.result || !row.eventId || !row.occurredAt)
      throw new ConflictException("El resultado del proveedor no está disponible.");
    const type =
      row.result === "PAID"
        ? "PAYMENT_SUCCEEDED"
        : row.result === "FAILED"
          ? "PAYMENT_FAILED"
          : "PAYMENT_CANCELLED";
    return {
      provider: "mock",
      eventId: row.eventId,
      providerReference: row.providerReference,
      type,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      occurredAt: row.occurredAt,
    };
  }
  async resolveCheckout(token: string, result: DemoResult) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.checkout(token, tx);
      const changed = await tx.mockPaymentCheckout.updateMany({
        where: { id: row.id, result: null, tokenHash: digest(token), expiresAt: { gt: new Date() } },
        data: { result, eventId: randomUUID(), occurredAt: new Date() },
      });
      const current = await tx.mockPaymentCheckout.findUniqueOrThrow({ where: { id: row.id } });
      if (!changed.count && (!current.result || current.tokenHash !== digest(token)))
        throw new ConflictException("El enlace fue reemplazado o venció.");
      return this.event(current);
    });
  }
  async resolveTransfer(providerReference: string, result: DemoResult) {
    this.enabled();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.mockPaymentCheckout.findUnique({ where: { providerReference } });
      if (!row || row.method !== "BANK_TRANSFER")
        throw new ConflictException("Solo transferencias simuladas.");
      await tx.mockPaymentCheckout.updateMany({
        where: { id: row.id, result: null },
        data: { result, eventId: randomUUID(), occurredAt: new Date() },
      });
      return this.event(await tx.mockPaymentCheckout.findUniqueOrThrow({ where: { id: row.id } }));
    });
  }
}
