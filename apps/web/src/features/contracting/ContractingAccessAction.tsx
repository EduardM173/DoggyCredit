import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, RefreshCw } from "lucide-react";
import { adminApi } from "../admin/api";

type Delivery = {
  delivery: "NOT_QUEUED" | "QUEUED" | "SENT" | "FAILED" | "REPLACED";
  sentAt?: string | null;
  channel?: "SMTP" | "TEST_INBOX" | null;
};

function statusText(state: Delivery["delivery"] | undefined, inTestInbox: boolean) {
  if (inTestInbox)
    return "El enlace se generó en la bandeja de pruebas de esta demostración. No se envió a una casilla externa.";
  switch (state) {
    case "SENT":
      return "El enlace personal fue enviado al correo verificado del representante.";
    case "QUEUED":
      return "El correo de contratación está en proceso de envío.";
    case "FAILED":
      return "No se pudo enviar el correo. Revisa la configuración y vuelve a intentarlo.";
    case "REPLACED":
      return "El enlace anterior fue reemplazado. Puedes enviar uno nuevo.";
    case "NOT_QUEUED":
      return "Esta solicitud anterior aún no tiene un correo de contratación enviado.";
    default:
      return "Consultando entrega del correo...";
  }
}

export function ContractingAccessAction({ requestId }: { requestId: string }) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      adminApi<Delivery>(`/institution-requests/${requestId}/contracting-email`)
        .then((value) => {
          if (active) setDelivery(value);
        })
        .catch(() => {
          if (active) setMessage("No se pudo consultar el estado del correo.");
        });
    void refresh();
    const interval = setInterval(() => {
      if (delivery?.delivery === "QUEUED") void refresh();
    }, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [requestId, delivery?.delivery]);

  async function resend() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await adminApi<Delivery>(`/institution-requests/${requestId}/contracting-email/resend`, {
        body: {},
      });
      setDelivery(result);
      setMessage("Se solicitó el envío al correo verificado de la solicitud.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo solicitar el reenvío.");
    } finally {
      setBusy(false);
    }
  }

  const state = delivery?.delivery;
  const inTestInbox = state === "SENT" && delivery?.channel === "TEST_INBOX";
  return (
    <section className="contracting-access-action">
      <h2>Acceso a contratación</h2>
      <p role="status">{statusText(state, inTestInbox)}</p>
      {state && state !== "QUEUED" && (
        <button className="button admin-primary" disabled={busy} onClick={resend}>
          {state === "SENT" ? <RefreshCw size={18} /> : <Mail size={18} />}
          {busy ? "Enviando..." : state === "SENT" ? "Reenviar correo" : "Enviar enlace por correo"}
        </button>
      )}
      {inTestInbox && (
        <small>
          Ábrelo desde <Link to="/admin/bandeja-pruebas">Bandeja de pruebas</Link>.
        </small>
      )}
      {state === "SENT" && (
        <small>Reenviar invalida el enlace y cualquier sesión de contratación anterior.</small>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
