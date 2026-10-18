import { useEffect, useState } from "react";
import { Inbox, RefreshCw, ShieldCheck } from "lucide-react";
import { adminApi, displayDate } from "./api";

type TestInboxResponse = {
  enabled: boolean;
  messages: {
    id: string;
    receivedAt: string;
    to: string;
    subject: string;
    text: string;
  }[];
};

export function TestInboxPage() {
  const [data, setData] = useState<TestInboxResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    adminApi<TestInboxResponse>("/test-inbox")
      .then((response) => {
        if (active) setData(response);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo cargar la bandeja de pruebas.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  function reload() {
    setError("");
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  return (
    <>
      <div className="admin-page-heading">
        <h1>Bandeja de pruebas</h1>
        <p>Consulta los correos simulados de la demostración sin afirmar que se enviaron a una casilla externa.</p>
      </div>
      <section className="admin-test-inbox" aria-label="Bandeja de correos de prueba">
        <div className="admin-test-inbox-actions">
          <span>
            <ShieldCheck size={20} /> Solo operadores autenticados pueden ver enlaces de demostración.
          </span>
          <button className="button admin-secondary" onClick={reload} disabled={loading}>
            <RefreshCw size={18} /> Actualizar
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Cargando bandeja de pruebas...</p>}
        {!loading && data && !data.enabled && (
          <p role="status">La bandeja de pruebas no está activa: este entorno usa SMTP configurado.</p>
        )}
        {!loading && data?.enabled && !data.messages.length && (
          <p role="status">Todavía no hay correos simulados en esta sesión de la API.</p>
        )}
        {!loading && data?.enabled && data.messages.length > 0 && (
          <div className="admin-test-inbox-list">
            {data.messages.map((message) => (
              <article key={message.id}>
                <header>
                  <Inbox size={20} />
                  <div>
                    <h2>{message.subject}</h2>
                    <p>
                      Para {message.to} · {displayDate(message.receivedAt)}
                    </p>
                  </div>
                </header>
                <pre>{message.text}</pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
