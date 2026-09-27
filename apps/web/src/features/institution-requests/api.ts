export type PlanInterest = string;
// Legacy labels are retained only to display historical requests made before the public catalog.
export const plans = [
  { value: "INITIAL", label: "Inicial" },
  { value: "BASIC", label: "Básico" },
  { value: "PROFESSIONAL", label: "Profesional" },
  { value: "INSTITUTIONAL", label: "Institucional" },
  { value: "ENTERPRISE", label: "Empresarial" },
  { value: "UNSURE", label: "Aún no estoy seguro" },
] as const;
export type InstitutionType = "BANK" | "FINANCIAL_INSTITUTION" | "COOPERATIVE" | "OTHER";
export type RequestInput = {
  institutionName: string;
  taxId: string;
  institutionType: InstitutionType | "";
  planInterest: PlanInterest;
  contactName: string;
  contactRole: string;
  contactEmail: string;
  contactPhone: string;
  representsInstitution: boolean;
  acceptsTerms: boolean;
};
export type RequestReceipt = {
  id: string;
  contactEmail: string;
  status: "EMAIL_PENDING";
  emailDelivery: "SENT" | "FAILED" | "UNAVAILABLE";
  retryAfterSeconds: number;
  resendAvailableAt?: number;
};

export function isReceipt(value: unknown): value is RequestReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<RequestReceipt>;
  return (
    typeof receipt.id === "string" &&
    typeof receipt.contactEmail === "string" &&
    receipt.status === "EMAIL_PENDING" &&
    ["SENT", "FAILED", "UNAVAILABLE"].includes(receipt.emailDelivery ?? "") &&
    typeof receipt.retryAfterSeconds === "number" &&
    receipt.retryAfterSeconds >= 0
  );
}

export async function submitInstitutionRequest(input: RequestInput): Promise<RequestReceipt> {
  const baseUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/institution-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "No pudimos confirmar el envío. Revisa tu conexión e inténtalo nuevamente; si la solicitud ya se guardó, te lo indicaremos.",
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409)
      throw new Error(
        "Ya existe una solicitud con ese NIT o correo. Revisa los datos antes de volver a enviarla.",
      );
    if (response.status === 400 && body?.message) {
      throw new Error(Array.isArray(body.message) ? body.message.join(" ") : String(body.message));
    }
    throw new Error("No pudimos procesar la solicitud. Inténtalo nuevamente en unos minutos.");
  }
  if (!isReceipt(body))
    throw new Error(
      "No pudimos confirmar la respuesta. No vuelvas a enviar sin comprobar el estado de tu solicitud.",
    );
  return { ...body, resendAvailableAt: Date.now() + body.retryAfterSeconds * 1000 };
}

export function validateRequest(input: RequestInput): Partial<Record<keyof RequestInput, string>> {
  const errors: Partial<Record<keyof RequestInput, string>> = {};
  const required = [
    ["institutionName", 180, "Ingresa el nombre o razón social."],
    ["contactName", 140, "Ingresa el nombre de la persona responsable."],
    ["contactRole", 120, "Ingresa su cargo."],
  ] as const;
  for (const [field, length, message] of required) {
    if (!input[field].trim()) errors[field] = message;
    else if (input[field].trim().length > length) errors[field] = `Usa como máximo ${length} caracteres.`;
  }
  if (!/^[0-9]{1,40}$/.test(input.taxId.replace(/[\s-]/g, "")))
    errors.taxId = "Ingresa un NIT de hasta 40 dígitos.";
  if (!["BANK", "FINANCIAL_INSTITUTION", "COOPERATIVE", "OTHER"].includes(input.institutionType))
    errors.institutionType = "Selecciona el tipo de institución.";
  if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(input.planInterest))
    errors.planInterest = "Selecciona un plan de interés.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail.trim()) || input.contactEmail.trim().length > 254)
    errors.contactEmail = "Ingresa un correo electrónico válido.";
  if (!/^\+[1-9][0-9]{7,14}$/.test(input.contactPhone.replace(/[\s()-]/g, "")))
    errors.contactPhone = "Ingresa un teléfono válido con código de país.";
  if (!input.representsInstitution)
    errors.representsInstitution = "Confirma que representas a la institución.";
  if (!input.acceptsTerms) errors.acceptsTerms = "Acepta los términos de uso y la política de privacidad.";
  return errors;
}
