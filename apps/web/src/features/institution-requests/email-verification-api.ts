export type Delivery = { emailDelivery: "SENT" | "FAILED" | "UNAVAILABLE"; retryAfterSeconds: number };
export type Verified = { contactEmail: string; status: "PENDING_REVIEW" };

export class VerificationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds = 0,
  ) {
    super(message);
  }
}

async function post(action: "verify" | "resend", input: object) {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/institution-requests/email-verification/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new VerificationError(
      "No pudimos confirmar la respuesta. Revisa tu conexión y vuelve a intentarlo.",
      0,
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After") ?? body?.retryAfterSeconds);
      throw new VerificationError(
        "Espera antes de solicitar otro correo.",
        429,
        Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
      );
    }
    if (response.status === 400)
      throw new VerificationError(
        "El enlace no es válido, venció, ya fue utilizado o fue reemplazado. Revisa el correo más reciente.",
        400,
      );
    throw new VerificationError(
      "No pudimos procesar la petición. Inténtalo nuevamente en unos minutos.",
      response.status,
    );
  }
  return body;
}

export async function verifyEmail(token: string): Promise<Verified> {
  const body = await post("verify", { token });
  if (body?.status !== "PENDING_REVIEW" || typeof body.contactEmail !== "string")
    throw new VerificationError("No pudimos confirmar la respuesta del servidor.", 500);
  return body;
}

export async function resendVerification(requestId: string): Promise<Delivery> {
  const body = await post("resend", { requestId });
  if (
    !["SENT", "FAILED", "UNAVAILABLE"].includes(body?.emailDelivery) ||
    typeof body.retryAfterSeconds !== "number" ||
    body.retryAfterSeconds < 0
  )
    throw new VerificationError("No pudimos confirmar el reenvío.", 500);
  return body;
}
