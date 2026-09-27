import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { RequestContextReader, ProvisioningQueue } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
import type { ProviderPaymentEvent } from "../infrastructure/payments/payment-provider.js";
@Injectable()
export class PaymentEventProcessor {
  private readonly logger = new Logger(PaymentEventProcessor.name);
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
    private readonly requests: RequestContextReader,
    private readonly provisioning: ProvisioningQueue,
  ) {}
  async process(event: ProviderPaymentEvent, actorUserId?: string) {
    return this.db.run(async () => {
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`provider-event:${event.provider}:${event.eventId}`},0))`;
      const duplicate = await this.db.client.paymentProviderEvent.findUnique({
        where: { provider_eventId: { provider: event.provider, eventId: event.eventId } },
      });
      if (duplicate) {
        if (
          duplicate.providerReference !== event.providerReference ||
          !duplicate.amount.equals(event.amount) ||
          duplicate.currency !== event.currency ||
          duplicate.eventType !== event.type
        )
          throw new ConflictException("El evento no coincide con el original.");
        this.logger.debug("Duplicate provider event acknowledged");
        return { duplicate: true };
      }
      const payment = await this.db.client.payment.findUnique({
        where: { providerReference: event.providerReference },
      });
      if (
        !payment ||
        payment.provider !== event.provider ||
        !payment.amount.equals(event.amount) ||
        payment.currency !== event.currency ||
        !["PAYMENT_SUCCEEDED", "PAYMENT_FAILED", "PAYMENT_CANCELLED"].includes(event.type) ||
        !Number.isFinite(event.occurredAt.getTime())
      ) {
        this.logger.warn("Provider event reference, amount, currency or type mismatch");
        throw new ConflictException("El evento no coincide con el pago esperado.");
      }
      const contract = await this.db.client.contracting.findUniqueOrThrow({
        where: { id: payment.contractingId },
      });
      await this.requests.approved(contract.requestId);
      const status =
        event.type === "PAYMENT_SUCCEEDED"
          ? "PAID"
          : event.type === "PAYMENT_FAILED"
            ? "FAILED"
            : "CANCELLED";
      const now = new Date();
      const changed = await this.db.client.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: {
          status,
          ...(status === "PAID"
            ? { paidAt: now }
            : status === "FAILED"
              ? { failedAt: now }
              : { cancelledAt: now }),
        },
      });
      if (changed.count) {
        await this.audit.recordCommerce({
          action: `PAYMENT_${status}`,
          entityType: "Payment",
          entityId: payment.id,
          actorKind: "PAYMENT_PROVIDER",
          actorUserId,
        });
        if (status === "PAID") {
          const confirmed = await this.db.client.contracting.updateMany({
            where: { id: contract.id, status: "PENDING_PAYMENT" },
            data: { status: "CONFIRMED", confirmedAt: now },
          });
          if (confirmed.count !== 1) throw new ConflictException("La contratación ya cambió.");
          await this.provisioning.ensurePending(contract.id, contract.requestId);
          await this.audit.recordCommerce({
            action: "CONTRACTING_CONFIRMED",
            entityType: "Contracting",
            entityId: contract.id,
            actorKind: "PAYMENT_PROVIDER",
            actorUserId,
          });
        }
      } else this.logger.warn("Terminal payment transition ignored");
      await this.db.client.paymentProviderEvent.create({
        data: {
          provider: event.provider,
          eventId: event.eventId,
          providerReference: event.providerReference,
          eventType: event.type,
          amount: event.amount,
          currency: event.currency,
          occurredAt: event.occurredAt,
          processedAt: now,
        },
      });
      return { duplicate: false, applied: changed.count === 1 };
    });
  }
}
