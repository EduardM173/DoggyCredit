import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleHelp,
  Clock,
  LoaderCircle,
  Mail,
  ShieldCheck,
  TriangleAlert,
  ArrowRight,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PublicInfo } from "../components/PublicInfo";
import { ResendVerification } from "../features/institution-requests/ResendVerification";
import {
  verifyEmail,
  VerificationError,
  type Verified,
} from "../features/institution-requests/email-verification-api";

export function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [input] = useState(() => {
    const params = new URLSearchParams(location.search);
    return { token: params.get("token") ?? "", requestId: params.get("requestId") ?? "" };
  });
  const call = useRef<Promise<Verified> | null>(null);
  const [result, setResult] = useState<Verified | null>(null);
  const [error, setError] = useState<VerificationError | null>(() =>
    input.token
      ? null
      : new VerificationError("Abre el enlace de verificación que recibiste por correo.", 400),
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void navigate("/verificar-correo", { replace: true });
    if (!input.token) {
      return;
    }
    // Share only this mounted route's promise across StrictMode effect replays.
    call.current ??= verifyEmail(input.token);
    let current = true;
    call.current
      .then((value) => {
        if (current) setResult(value);
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof VerificationError
              ? reason
              : new VerificationError("No pudimos verificar tu correo.", 500),
          );
      });
    return () => {
      current = false;
    };
  }, [input.token, attempt, navigate]);
  const hasReference = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    input.requestId,
  );
  if (!result)
    return (
      <main id="main-content" className="verification-state container">
        <div className={`success-icon${error ? " verification-error" : ""}`}>
          {error ? <TriangleAlert size={44} /> : <LoaderCircle className="spinner" size={44} />}
        </div>
        <h1>{error ? "No pudimos confirmar tu correo" : "Verificando tu correo"}</h1>
        <p role={error ? "alert" : "status"}>
          {error?.message ?? "Espera un momento mientras comprobamos tu enlace."}
        </p>
        {error && (
          <div className="verification-actions">
            {(error.status === 0 || error.status >= 500) && (
              <button
                className="button button-primary"
                onClick={() => {
                  call.current = null;
                  setError(null);
                  setAttempt((value) => value + 1);
                }}
              >
                Reintentar verificación
              </button>
            )}
            {hasReference && <ResendVerification requestId={input.requestId} />}
            <Link to="/" className="button button-outline">
              Volver al inicio
            </Link>
          </div>
        )}
        {error && !hasReference && (
          <p>Para reenviar el enlace, vuelve a la pestaña donde enviaste tu solicitud.</p>
        )}
      </main>
    );
  return (
    <main id="main-content" className="received-page verified-page">
      <div className="container received-grid">
        <section className="receipt-summary">
          <div className="success-icon">
            <Check size={68} strokeWidth={3.4} />
          </div>
          <p className="confirmed-label">CORREO CONFIRMADO</p>
          <h1>¡Gracias! Tu correo ha sido verificado</h1>
          <p className="receipt-description">
            Tu solicitud de acceso ha sido recibida correctamente y ahora se encuentra en revisión por nuestro
            equipo.
          </p>
          <div className="receipt-email">
            <span className="round-icon">
              <Mail size={33} />
            </span>
            <div>
              <p className="eyebrow">Correo verificado</p>
              <strong>{result.contactEmail}</strong>
              <p>
                Tu dirección de correo ha sido confirmada. Te enviaremos un correo cuando tengamos una
                decisión sobre tu solicitud.
              </p>
            </div>
          </div>
          <section className="verified-security">
            <ShieldCheck size={38} />
            <div>
              <h2>Tu información está segura</h2>
              <p>
                La información que proporcionaste se utiliza únicamente para gestionar esta solicitud de
                acceso a DoggyCredit.
              </p>
              <PublicInfo kind="privacy">
                Política de privacidad <ArrowRight size={16} />
              </PublicInfo>
            </div>
          </section>
        </section>
        <aside className="receipt-aside verified-aside">
          <section className="next-steps next-steps-received">
            <h2>¿Qué sigue ahora?</h2>
            <p>
              Tu solicitud está en revisión. Te mantendremos informado por correo en cada etapa del proceso.
            </p>
            <ol>
              {[
                ["Correo verificado", "Has confirmado tu dirección de correo electrónico."],
                [
                  "Revisión de la solicitud",
                  "Nuestro equipo revisará la información de tu institución. Te contactaremos si necesitamos detalles adicionales.",
                ],
                [
                  "Notificación de decisión",
                  "Te enviaremos un correo con el resultado de la solicitud y los siguientes pasos.",
                ],
              ].map(([title, description], index) => (
                <li key={title}>
                  <span className="step-number" aria-hidden="true">
                    {index === 0 ? <Check size={24} /> : index + 1}
                  </span>
                  <div>
                    <h3>
                      {title} {index === 1 && <span className="review-badge">En proceso</span>}
                    </h3>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="review-next">
              <Clock size={30} />
              <div>
                <h3>Próximo paso</h3>
                <p>Te notificaremos por correo cuando la revisión haya finalizado.</p>
              </div>
            </div>
          </section>
          <section className="verified-contact">
            <CircleHelp size={30} />
            <div>
              <h3>¿Tienes alguna consulta?</h3>
              <p>Nuestro equipo te ayudará.</p>
            </div>
            <PublicInfo kind="contact" className="button button-outline">
              Contactar <ArrowRight size={16} />
            </PublicInfo>
          </section>
        </aside>
      </div>
    </main>
  );
}
