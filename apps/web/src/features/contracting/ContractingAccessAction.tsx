import { useState } from "react";
import { Copy, ExternalLink, Link2 } from "lucide-react";
import { adminApi } from "../admin/api";
export function ContractingAccessAction({ requestId }: { requestId: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function generate() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await adminApi<{ url: string }>(
        `/institution-requests/${requestId}/contracting-access`,
        { body: {} },
      );
      setUrl(result.url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo generar el enlace.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="contracting-access-action">
      <h2>Acceso a contratación</h2>
      <p>El enlace es de un solo uso. Generar otro invalida los enlaces y sesiones anteriores.</p>
      <button className="button admin-primary" disabled={busy} onClick={generate}>
        <Link2 size={18} />
        {busy ? "Generando..." : "Generar enlace de contratación"}
      </button>
      {url && (
        <div>
          <a className="button admin-secondary" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            Abrir contratación
          </a>
          <button
            className="button admin-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setMessage("Enlace copiado.");
              } catch {
                setMessage("No se pudo copiar. Usa Abrir contratación.");
              }
            }}
          >
            <Copy size={17} />
            Copiar enlace
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
