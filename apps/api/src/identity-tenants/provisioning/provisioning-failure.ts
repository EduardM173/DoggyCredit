import { ProvisioningEligibilityError } from "../../plans-metering/public.js";
export function provisioningFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof ProvisioningEligibilityError) return { code: error.code, retryable: false };
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const meta = typeof error === "object" && error && "meta" in error ? error.meta : null;
  if (
    code === "P2010" &&
    typeof meta === "object" &&
    meta &&
    "code" in meta &&
    ["40001", "40P01", "57014"].includes(String(meta.code))
  )
    return { code: "DATABASE_TEMPORARY", retryable: true };
  if (["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034", "40001", "40P01"].includes(code))
    return { code: "DATABASE_TEMPORARY", retryable: true };
  if (code === "P2002" || code === "P2003") return { code: "DATA_CONFLICT", retryable: false };
  return { code: "PROVISIONING_INTERNAL_ERROR", retryable: false };
}
