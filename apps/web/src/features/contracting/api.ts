export interface Plan {
  id: string;
  code: string;
  name: string;
  price: string;
  currency: string;
  billingPeriod: string;
  requiresPayment: boolean;
  features: string[];
}
export interface Payment {
  id: string;
  reference: string;
  method: "BANK_TRANSFER" | "QR" | "CARD";
  amount: string;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "CANCELLED";
  createdAt: string;
  resolvedAt: string | null;
  initialized: boolean;
}
export interface Contracting {
  id: string;
  confirmedPlanId: string;
  planCode: string;
  planName: string;
  price: string;
  currency: string;
  billingPeriod: string;
  requiresPayment: boolean;
  status: "PENDING_PAYMENT" | "CONFIRMED";
  confirmedAt: string | null;
  payment: Payment | null;
}
export interface Context {
  institution: {
    id: string;
    institutionName: string;
    contactName: string;
    contactEmail: string;
    planInterest: string | null;
  };
  plans: Plan[];
  paymentProvider: string;
  contracting: Contracting | null;
}
export interface Checkout {
  checkoutUrl: string;
  expiresAt: string;
}
export class CommerceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function commerceApi<T>(
  path: string,
  options: { body?: unknown; token?: string; key?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    credentials: "include",
    cache: "no-store",
    signal: options.signal,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json", "X-DoggyCredit-Admin": "1" }
        : {}),
      ...(options.token ? { "X-DoggyPay-Token": options.token } : {}),
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    },
    ...(options.body !== undefined ? { method: "POST", body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "El acceso venció o no está disponible. Solicita un nuevo enlace de contratación.",
      403: "No tienes autorización para esta acción.",
      404: "No encontramos el recurso solicitado.",
      409: "El estado cambió o esta operación ya no está disponible. Actualiza para consultar el estado real.",
      410: "El checkout venció. Genera un nuevo enlace desde DoggyCredit.",
      429: "Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
      503: "No se pudo iniciar el proveedor. Puedes reintentar el mismo pago.",
    };
    throw new CommerceError(
      response.status,
      messages[response.status] ?? "No se pudo completar la operación. Intenta nuevamente.",
    );
  }
  return response.json();
}
export const money = (amount: string, currency = "BOB") =>
  new Intl.NumberFormat("es-BO", { style: "currency", currency, minimumFractionDigits: 2 }).format(
    Number(amount),
  );
export const methods = {
  BANK_TRANSFER: "Transferencia bancaria",
  QR: "QR",
  CARD: "Tarjeta simulada",
} as const;
export const paymentLabels = {
  PENDING: "Pago pendiente",
  PAID: "Pago confirmado",
  FAILED: "Pago rechazado",
  CANCELLED: "Pago cancelado",
} as const;
