import { useRef } from "react";
import { X } from "lucide-react";

const content = {
  terms: {
    title: "Términos de uso",
    text: "Esta es una demostración académica de DoggyCredit. Solicitar acceso inicia la revisión de una institución; no crea una cuenta ni garantiza su aprobación. Los términos definitivos del servicio están pendientes de publicación.",
  },
  privacy: {
    title: "Política de privacidad",
    text: "El formulario registra los datos de la institución y de su representante para gestionar la solicitud de acceso. Para esta demostración, utiliza datos ficticios. La política de privacidad definitiva está pendiente de publicación.",
  },
  contact: {
    title: "Contacto",
    text: "El canal de contacto de DoggyCredit estará disponible próximamente. Puedes iniciar el proceso de incorporación desde Solicitar acceso.",
  },
};
export function PublicInfo({
  kind,
  children,
  className = "text-link",
}: {
  kind: keyof typeof content;
  children: React.ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const info = content[kind];
  return (
    <>
      <button type="button" className={className} onClick={() => dialog.current?.showModal()}>
        {children}
      </button>
      <dialog ref={dialog} className="info-dialog" aria-label={info.title}>
        <button
          type="button"
          className="icon-button dialog-close"
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <h2>{info.title}</h2>
        <p>{info.text}</p>
        <button type="button" className="button button-primary" onClick={() => dialog.current?.close()}>
          Entendido
        </button>
      </dialog>
    </>
  );
}
