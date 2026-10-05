import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, ShieldCheck, XCircle } from "lucide-react";
import { commerceApi, money, methods, paymentLabels, type Payment } from "./api";
type Demo = {
  reference: string;
  amount: string;
  currency: string;
  method: Payment["method"];
  status: Payment["status"];
  expiresAt: string;
};
export function DoggyPayPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [data, setData] = useState<Demo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
    let mounted = true;
    if (!token) {
      setTimeout(() => {
        if (mounted) setError("Escanea nuevamente el QR o abre el enlace de DoggyPay Demo.");
      }, 0);
      return () => {
        mounted = false;
      };
    }
    commerceApi<Demo>("/mock-payment-provider/checkout", { token })
      .then((value) => {
        if (mounted) setData(value);
      })
      .catch((e: Error) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, [token]);
  async function resolve(result: "PAID" | "FAILED" | "CANCELLED") {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await commerceApi<{ status: Payment["status"] }>(
        "/mock-payment-provider/checkout/result",
        { token, body: { result } },
      );
      setData((old) => (old ? { ...old, status: response.status } : old));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el resultado. Reintenta.");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="doggypay">
      <header>
        <ShieldCheck size={32} />
        <h1>
          DoggyPay <span>Demo</span>
        </h1>
      </header>
      <div className="commerce-simulation">
        <strong>ENTORNO DE SIMULACIÓN</strong>
        <span>No se procesará dinero real.</span>
      </div>
      {data ? (
        <>
          <p className="commerce-eyebrow">COMERCIO: DOGGYCREDIT</p>
          <h2>{money(data.amount, data.currency)}</h2>
          <p>{methods[data.method]}</p>
          <p className="doggypay-reference">Referencia: {data.reference}</p>
          <div className={`commerce-payment-state state-${data.status}`}>
            {data.status === "PAID" ? <CheckCircle2 /> : data.status === "PENDING" ? <Clock3 /> : <XCircle />}
            <strong>{paymentLabels[data.status]}</strong>
          </div>
          {data.status === "PENDING" ? (
            <div className="doggypay-actions">
              <button className="button commerce-primary" disabled={busy} onClick={() => resolve("PAID")}>
                {busy ? "Procesando..." : "Confirmar pago simulado"}
              </button>
              <button className="button commerce-danger" disabled={busy} onClick={() => resolve("FAILED")}>
                Simular rechazo
              </button>
              <button
                className="button commerce-secondary"
                disabled={busy}
                onClick={() => resolve("CANCELLED")}
              >
                Cancelar pago
              </button>
            </div>
          ) : (
            <p>Resultado registrado. Puedes volver a la computadora.</p>
          )}
        </>
      ) : (
        !error && <p role="status">Consultando checkout...</p>
      )}
      {error && (
        <p className="commerce-error" role="alert">
          {error}
        </p>
      )}
      <footer>No ingreses tarjetas, cuentas ni contraseñas bancarias.</footer>
    </main>
  );
}
