export type Status = "EMAIL_PENDING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
export const statusLabels: Record<Status, string> = {
  EMAIL_PENDING: "Correo pendiente",
  PENDING_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
};
export interface Session {
  user: { id: string; fullName: string; email: string; platformRole: string };
  expiresAt: string;
}
export interface ReviewItem {
  id: string;
  institutionName: string;
  taxId: string;
  contactEmail: string;
  planInterest: string | null;
  status: Status;
  createdAt: string;
}
export interface ReviewDetail extends ReviewItem {
  institutionType: string;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  emailVerifiedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewer: { fullName: string } | null;
}
export interface ReviewList {
  items: ReviewItem[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}
export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function adminApi<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/admin${path}`, {
    credentials: "include",
    cache: "no-store",
    signal: options.signal,
    ...(options.body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DoggyCredit-Admin": "1" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  if (!response.ok) {
    let message = "No se pudo completar la operación. Intenta nuevamente.";
    if (response.status === 401)
      message =
        path === "/auth/login" ? "Credenciales incorrectas." : "Tu sesión terminó. Inicia sesión nuevamente.";
    if (response.status === 403) message = "No tienes autorización para esta operación.";
    if (response.status === 404) message = "La solicitud no existe.";
    if (response.status === 409)
      message = "La solicitud cambió o ya fue resuelta. Se ha actualizado el detalle.";
    if (response.status === 429) message = "Demasiados intentos. Intenta nuevamente en unos minutos.";
    throw new AdminError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
export const displayDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
        new Date(value),
      )
    : "No registrada";
