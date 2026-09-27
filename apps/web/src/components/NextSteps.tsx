import { Send } from "lucide-react";

export function NextSteps({ received = false }: { received?: boolean }) {
  const steps = received
    ? [
        ["Confirma tu correo", "Haz clic en el enlace que te enviamos para validar tu dirección de correo."],
        [
          "Revisión de la solicitud",
          "Nuestro equipo revisará la información de tu institución y se pondrá en contacto contigo.",
        ],
        ["Notificación de decisión", "Te enviaremos un correo con la decisión y los siguientes pasos."],
      ]
    : [
        [
          "Envías la solicitud",
          "Completas el formulario con la información básica de tu institución y tus datos de contacto.",
        ],
        ["Verificas tu correo", "El siguiente paso será confirmar tu dirección de correo electrónico."],
        [
          "Nuestro equipo revisa la institución",
          "Analizamos la información y te notificaremos la decisión por correo.",
        ],
      ];
  return (
    <section
      className={`next-steps${received ? " next-steps-received" : ""}`}
      aria-labelledby="next-steps-title"
    >
      <div className="steps-heading">
        {!received && (
          <span className="round-icon">
            <Send size={27} />
          </span>
        )}
        <div>
          <h2 id="next-steps-title">{received ? "¿Qué sigue ahora?" : "¿Qué sucede después?"}</h2>
          {!received && <p>Te explicamos los siguientes pasos del proceso.</p>}
        </div>
      </div>
      <ol>
        {steps.map(([title, description], index) => (
          <li key={title}>
            <span className="step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
