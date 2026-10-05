import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { resendVerification, VerificationError, type Delivery } from "./email-verification-api";

export function ResendVerification({
  requestId,
  availableAt = 0,
  unavailable = false,
  onResult,
}: {
  requestId: string;
  availableAt?: number;
  unavailable?: boolean;
  onResult?: (delivery: Delivery, deadline: number) => void;
}) {
  const [deadline, setDeadline] = useState(availableAt);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [blocked, setBlocked] = useState(unavailable);
  const [feedback, setFeedback] = useState("");
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  async function resend() {
    if (running.current || seconds > 0 || blocked) return;
    running.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const result = await resendVerification(requestId);
      const next = Date.now() + result.retryAfterSeconds * 1000;
      setDeadline(next);
      setNow(Date.now());
      setBlocked(result.emailDelivery === "UNAVAILABLE");
      onResult?.(result, next);
      setFeedback(
        result.emailDelivery === "SENT"
          ? "Enviamos un nuevo enlace. Revisa tu bandeja de entrada y spam."
          : result.emailDelivery === "FAILED"
            ? "Tu solicitud está guardada, pero no pudimos confirmar el envío. Podrás reintentarlo al terminar la espera."
            : "No hay un reenvío disponible para esta referencia. Revisa si ya confirmaste tu correo.",
      );
    } catch (error) {
      if (error instanceof VerificationError && error.status === 429) {
        const next = Date.now() + error.retryAfterSeconds * 1000;
        setDeadline(next);
        setNow(Date.now());
      }
      setFeedback(error instanceof Error ? error.message : "No pudimos reenviar el correo.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const countdown = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return (
    <div className="resend-control">
      <button
        type="button"
        className="button button-outline"
        onClick={resend}
        disabled={busy || seconds > 0 || blocked}
      >
        {busy ? <LoaderCircle size={17} className="spinner" /> : <Send size={17} />}
        {busy
          ? "Enviando correo"
          : blocked
            ? "Reenvío no disponible"
            : seconds > 0
              ? `Podrás reenviar en ${countdown}`
              : "Reenviar correo"}
      </button>
      {feedback && <p role="status">{feedback}</p>}
    </div>
  );
}
