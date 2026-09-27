import { Check, CircleHelp, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { NextSteps } from "../components/NextSteps";
import { PublicInfo } from "../components/PublicInfo";
import { isReceipt } from "../features/institution-requests/api";
import { ResendVerification } from "../features/institution-requests/ResendVerification";

export function RequestReceivedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mountedAt] = useState(() => Date.now());
  const receipt: unknown = location.state?.receipt;
  if (!isReceipt(receipt)) return <Navigate to="/solicitar-acceso" replace />;
  return (
    <main className="received-page" id="main-content">
      <div className="container received-grid">
        <section className="receipt-summary">
          <div className="success-icon">
            <Check size={68} strokeWidth={3.4} />
          </div>
          <h1>
            Solicitud <span>recibida</span>
          </h1>
          <h2>Revisa tu correo para continuar</h2>
          <p className="receipt-description">
            {receipt.emailDelivery === "SENT"
              ? "Hemos enviado un enlace de verificación a tu correo electrónico. Confirma tu dirección para continuar con el proceso de acceso a DoggyCredit."
              : "Tu solicitud fue recibida y está guardada. No pudimos confirmar el envío del correo; puedes solicitar un nuevo enlace aquí."}
          </p>
          <div className="receipt-email">
            <span className="round-icon">
              <Mail size={33} />
            </span>
            <div>
              <p className="eyebrow">
                {receipt.emailDelivery === "SENT" ? "Mensaje enviado a" : "Correo de tu solicitud"}
              </p>
              <strong>{receipt.contactEmail}</strong>
              <p>
                {receipt.emailDelivery === "SENT"
                  ? "Si no encuentras el correo, revisa tu carpeta de spam o correos no deseados."
                  : "No necesitas completar el formulario otra vez. Usa la opción de reenvío para continuar."}
              </p>
            </div>
          </div>
          <div className="resend-notice">
            <CircleHelp size={34} />
            <div>
              <h3>¿No recibiste el correo?</h3>
              <p>
                Revisa tu carpeta de spam. Si no aparece, solicita un nuevo enlace cuando termine la espera.
              </p>
            </div>
            <ResendVerification
              requestId={receipt.id}
              availableAt={receipt.resendAvailableAt ?? mountedAt + receipt.retryAfterSeconds * 1000}
              unavailable={receipt.emailDelivery === "UNAVAILABLE"}
              onResult={(result, deadline) => {
                void navigate("/solicitud-recibida", {
                  replace: true,
                  state: { receipt: { ...receipt, ...result, resendAvailableAt: deadline } },
                });
              }}
            />
          </div>
        </section>
        <aside className="receipt-aside">
          <div
            className="email-illustration"
            role="img"
            aria-label="Ilustración de un sobre con un correo electrónico"
          >
            <img src="/images/confirmation-reference.png" alt="" />
          </div>
          <NextSteps received />
        </aside>
      </div>
      <section className="receipt-security">
        <div className="container">
          <span className="feature-icon">
            <ShieldCheck size={30} />
          </span>
          <div>
            <h3>Tu información está segura</h3>
            <p>
              Solo utilizamos tus datos para gestionar tu solicitud de acceso a DoggyCredit.{" "}
              <PublicInfo kind="privacy">Política de privacidad</PublicInfo>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
