export type DemoResult = "PAID" | "FAILED" | "CANCELLED";
export type ProviderEventType = "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "PAYMENT_CANCELLED";
export interface ProviderPaymentEvent {
  provider: string;
  eventId: string;
  providerReference: string;
  type: ProviderEventType;
  amount: string;
  currency: string;
  occurredAt: Date;
}
export interface CheckoutInput {
  paymentId: string;
  reference: string;
  amount: string;
  currency: string;
  method: "BANK_TRANSFER" | "QR" | "CARD";
}
export abstract class PaymentProvider {
  abstract createCheckout(input: CheckoutInput): Promise<{ providerReference: string }>;
  abstract rotateCheckout(providerReference: string): Promise<{ checkoutUrl: string; expiresAt: string }>;
  abstract describeCheckout(token: string): Promise<{
    reference: string;
    amount: string;
    currency: string;
    method: string;
    status: string;
    expiresAt: string;
  }>;
  abstract resolveCheckout(token: string, result: DemoResult): Promise<ProviderPaymentEvent>;
  abstract resolveTransfer(providerReference: string, result: DemoResult): Promise<ProviderPaymentEvent>;
}
