export type PublicPlan = {
  code: string;
  name: string;
  shortDescription: string | null;
  price: string;
  currency: string;
  billingPeriod: string;
  requiresPayment: boolean;
  highlights: string[];
};

export async function fetchPublicPlans(signal?: AbortSignal): Promise<PublicPlan[]> {
  const baseUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/public/plans`, { signal });
  if (!response.ok) throw new Error("No pudimos cargar los planes.");
  const value: unknown = await response.json();
  if (!Array.isArray(value) || !value.every(isPublicPlan)) throw new Error("Catálogo de planes inválido.");
  return value;
}

function isPublicPlan(value: unknown): value is PublicPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<PublicPlan>;
  return (
    typeof plan.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,49}$/.test(plan.code) &&
    typeof plan.name === "string" &&
    (plan.shortDescription === null || typeof plan.shortDescription === "string") &&
    typeof plan.price === "string" &&
    /^\d+\.\d{2}$/.test(plan.price) &&
    typeof plan.currency === "string" &&
    typeof plan.billingPeriod === "string" &&
    typeof plan.requiresPayment === "boolean" &&
    Array.isArray(plan.highlights) &&
    plan.highlights.every((item) => typeof item === "string")
  );
}

export function formatPlanPrice(plan: PublicPlan) {
  const [whole, cents] = plan.price.split(".");
  const amount = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${cents === "00" ? "" : `,${cents}`}`;
  const currency = plan.currency === "BOB" ? "Bs" : plan.currency;
  const period = plan.billingPeriod === "MONTHLY" ? "mes" : plan.billingPeriod;
  return `${currency} ${amount} / ${period}`;
}
