import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { IntegrationHealthState } from "./api";

const config: Record<
  IntegrationHealthState,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  OPERATIVO_OBSERVADO: { label: "Operativo (observado)", className: "integration-chip--ok", Icon: CheckCircle2 },
  DEGRADADO_OBSERVADO: { label: "Degradado (observado)", className: "integration-chip--bad", Icon: AlertTriangle },
  SIN_SENAL_RECIENTE: { label: "Sin señal reciente", className: "integration-chip--unknown", Icon: HelpCircle },
  ERROR_MONITOREO: { label: "Error de monitoreo", className: "integration-chip--warn", Icon: XCircle },
};

export function IntegrationStatusChip({ state }: { state: IntegrationHealthState }) {
  const { label, className, Icon } = config[state] ?? config.SIN_SENAL_RECIENTE;
  return (
    <span className={`integration-chip ${className}`}>
      <Icon size={16} aria-hidden="true" />
      {label}
    </span>
  );
}