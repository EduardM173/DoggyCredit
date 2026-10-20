import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { institutionApi } from "./api";

export interface IntegrationStatusItem {
  providerName: string;
  availability: "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "UNKNOWN";
  message: string;
}

/** HU-23 / T05: avisa de interrupciones temporales. Un fallo al consultar el estado no muestra nada. */
export function IntegrationNotice({ slug, refreshKey }: { slug: string; refreshKey?: string }) {
  const [items, setItems] = useState<IntegrationStatusItem[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await institutionApi<IntegrationStatusItem[]>(
          `/tenants/${encodeURIComponent(slug)}/integrations/status`,
        );
        if (active && Array.isArray(result)) setItems(result);
      } catch {
        if (active) setItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, refreshKey]);

  const down = items.filter((item) => item.availability === "TEMPORARILY_UNAVAILABLE");
  if (down.length === 0) return null;

  return (
    <div className="eval-integration-notice" role="status">
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <strong>Fuentes con interrupción temporal</strong>
        <ul>
          {down.map((item) => (
            <li key={item.providerName}>
              {item.providerName}: {item.message}
            </li>
          ))}
        </ul>
        <p>Puedes iniciar la evaluación igualmente; si falla, podrás reintentarla sobre el mismo caso.</p>
      </div>
    </div>
  );
}