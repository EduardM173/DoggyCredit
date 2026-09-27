import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { RequestContextReader } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
import { PaymentProvider, type DemoResult } from "../infrastructure/payments/payment-provider.js";
import { ContractingAccessService } from "./contracting-access.service.js";
import { PaymentEventProcessor } from "./payment-event-processor.js";
import type { Payment } from "../generated/prisma/client.js";
const planSelect = {
  id: true,
  code: true,
  name: true,
  price: true,
  currency: true,
  billingPeriod: true,
  requiresPayment: true,
  features: true,
} as const;
@Injectable()
export class ContractingService {
  private readonly logger = new Logger(ContractingService.name);
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly requests: RequestContextReader,
    private readonly access: ContractingAccessService,
    private readonly audit: AuditWriter,
    private readonly provider: PaymentProvider,
    private readonly processor: PaymentEventProcessor,
    private readonly config: ConfigService,
  ) {}
  private paymentView(row: Payment) {
    return {
      id: row.id,
      reference: row.reference,
      method: row.method,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: (row.paidAt ?? row.failedAt ?? row.cancelledAt)?.toISOString() ?? null,
      initialized: !!row.providerReference,
    };
  }
  async context(requestId: string) {
    const institution = await this.requests.approved(requestId);
    const plans = await this.db.client.plan.findMany({
      where: {
        active: true,
        price: { not: null },
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: { not: null },
      },
      select: planSelect,
      orderBy: [{ price: "asc" }, { id: "asc" }],
    });
    const contract = await this.db.client.contracting.findUnique({
      where: { requestId },
      include: { payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } },
    });
    return {
      institution,
      plans: plans.map((plan) => ({ ...plan, price: plan.price!.toFixed(2) })),
      paymentProvider: this.config.get("PAYMENT_PROVIDER"),
      contracting: contract
        ? {
            id: contract.id,
            confirmedPlanId: contract.confirmedPlanId,
            planCode: contract.planCodeSnapshot,
            planName: contract.planNameSnapshot,
            price: contract.priceSnapshot.toFixed(2),
            currency: contract.currencySnapshot,
            billingPeriod: contract.billingPeriodSnapshot,
            requiresPayment: contract.requiresPaymentSnapshot,
            status: contract.status,
            confirmedAt: contract.confirmedAt?.toISOString() ?? null,
            payment: contract.payments[0] ? this.paymentView(contract.payments[0]) : null,
          }
        : null,
    };
  }
  async confirmPlan(requestId: string, planId: string) {
    await this.db.run(async () => {
      await this.access.lockApproved(requestId);
      const existing = await this.db.client.contracting.findUnique({ where: { requestId } });
      if (existing) {
        if (existing.confirmedPlanId === planId) return;
        throw new ConflictException("El plan ya fue confirmado. No se puede cambiar dentro de este flujo.");
      }
      const plan = await this.db.client.plan.findUnique({ where: { id: planId } });
      if (
        !plan ||
        !plan.active ||
        plan.price === null ||
        plan.currency !== "BOB" ||
        plan.billingPeriod !== "MONTHLY" ||
        plan.requiresPayment === null
      )
        throw new NotFoundException("Plan no disponible.");
      if (
        plan.price.isNegative() ||
        (plan.requiresPayment && !plan.price.greaterThan(0)) ||
        (!plan.requiresPayment && !plan.price.isZero())
      )
        throw new ConflictException("El plan tiene condiciones comerciales inconsistentes.");
      const contract = await this.db.client.contracting.create({
        data: {
          requestId,
          confirmedPlanId: plan.id,
          planCodeSnapshot: plan.code,
          planNameSnapshot: plan.name,
          priceSnapshot: plan.price,
          currencySnapshot: plan.currency,
          billingPeriodSnapshot: plan.billingPeriod,
          requiresPaymentSnapshot: plan.requiresPayment,
          status: plan.requiresPayment ? "PENDING_PAYMENT" : "CONFIRMED",
          confirmedAt: plan.requiresPayment ? null : new Date(),
        },
      });
      await this.audit.recordCommerce({
        action: "CONTRACTING_PLAN_CONFIRMED",
        entityType: "Contracting",
        entityId: contract.id,
        actorKind: "REPRESENTATIVE",
      });
      if (!plan.requiresPayment)
        await this.audit.recordCommerce({
          action: "CONTRACTING_CONFIRMED",
          entityType: "Contracting",
          entityId: contract.id,
          actorKind: "REPRESENTATIVE",
        });
    });
    return this.context(requestId);
  }
  async createPayment(requestId: string, method: "BANK_TRANSFER" | "QR" | "CARD", idempotencyKey: string) {
    if (this.config.get("PAYMENT_PROVIDER") !== "mock")
      throw new ServiceUnavailableException("El proveedor de pagos no está habilitado.");
    const payment = await this.db.run(async () => {
      await this.access.lockApproved(requestId);
      const contract = await this.db.client.contracting.findUnique({ where: { requestId } });
      if (!contract || !contract.requiresPaymentSnapshot)
        throw new ConflictException("La contratación no requiere un pago.");
      const previous = await this.db.client.payment.findUnique({
        where: { contractingId_idempotencyKey: { contractingId: contract.id, idempotencyKey } },
      });
      if (previous) {
        if (previous.method !== method) throw new ConflictException("La clave ya corresponde a otro método.");
        return previous;
      }
      if (contract.status !== "PENDING_PAYMENT")
        throw new ConflictException("La contratación ya está confirmada.");
      const pending = await this.db.client.payment.findFirst({
        where: { contractingId: contract.id, status: "PENDING" },
      });
      if (pending) {
        if (pending.method !== method)
          throw new ConflictException("Ya existe un pago pendiente con otro método.");
        return pending;
      }
      const row = await this.db.client.payment.create({
        data: {
          contractingId: contract.id,
          reference: `DC-PAY-${new Date().getUTCFullYear()}-${randomUUID()}`,
          provider: "mock",
          method,
          amount: contract.priceSnapshot,
          currency: contract.currencySnapshot,
          idempotencyKey,
        },
      });
      await this.audit.recordCommerce({
        action: "PAYMENT_CREATED",
        entityType: "Payment",
        entityId: row.id,
        actorKind: "REPRESENTATIVE",
      });
      return row;
    });
    if (payment.status === "PENDING") await this.initialize(payment);
    return this.context(requestId);
  }
  private async initialize(payment: Payment) {
    if (payment.providerReference) return payment.providerReference;
    try {
      const result = await this.provider.createCheckout({
        paymentId: payment.id,
        reference: payment.reference,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        method: payment.method,
      });
      await this.db.client.payment.updateMany({
        where: { id: payment.id, status: "PENDING", providerReference: null },
        data: { providerReference: result.providerReference },
      });
      return result.providerReference;
    } catch {
      this.logger.warn("Payment provider initialization failed; existing attempt retained");
      throw new ServiceUnavailableException("No se pudo iniciar el proveedor. Reintenta el mismo pago.");
    }
  }
  async checkout(requestId: string) {
    await this.requests.approved(requestId);
    const contract = await this.db.client.contracting.findUnique({ where: { requestId } });
    if (!contract) throw new NotFoundException();
    const payment = await this.db.client.payment.findFirst({
      where: { contractingId: contract.id, status: "PENDING" },
    });
    if (!payment || payment.method === "BANK_TRANSFER")
      throw new ConflictException("No hay un checkout pendiente.");
    return this.provider.rotateCheckout(await this.initialize(payment));
  }
  async status(requestId: string) {
    const view = await this.context(requestId);
    return {
      contractingStatus: view.contracting?.status ?? null,
      confirmedAt: view.contracting?.confirmedAt ?? null,
      payment: view.contracting?.payment ?? null,
    };
  }
  async adminList(page: number) {
    const rows = await this.db.client.contracting.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 10,
      take: 10,
      include: { payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
    });
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        institution: (await this.requests.get(row.requestId)).institutionName,
        requestId: row.requestId,
        planName: row.planNameSnapshot,
        amount: row.priceSnapshot.toFixed(2),
        currency: row.currencySnapshot,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        payments: row.payments.map((p) => this.paymentView(p)),
      })),
    );
    return {
      items,
      page,
      total: await this.db.client.contracting.count(),
      pageSize: 10,
      paymentProvider: this.config.get("PAYMENT_PROVIDER"),
    };
  }
  async simulateTransfer(paymentId: string, result: DemoResult, actorUserId: string) {
    const payment = await this.db.client.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.method !== "BANK_TRANSFER")
      throw new NotFoundException("Transferencia no encontrada.");
    const contract = await this.db.client.contracting.findUniqueOrThrow({
      where: { id: payment.contractingId },
    });
    await this.requests.approved(contract.requestId);
    const reference = await this.initialize(payment);
    return this.processor.process(await this.provider.resolveTransfer(reference, result), actorUserId);
  }
}
