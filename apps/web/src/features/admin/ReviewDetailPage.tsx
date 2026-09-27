import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Building2, CheckCircle2, Clock3, Info, MailCheck, XCircle } from "lucide-react";
import { plans } from "../institution-requests/api";
import { ContractingAccessAction } from "../contracting/ContractingAccessAction";
import { adminApi, AdminError, displayDate, statusLabels, type ReviewDetail } from "./api";

const institutionLabels: Record<string, string> = {
  BANK: "Banco",
  FINANCIAL_INSTITUTION: "Financiera",
  COOPERATIVE: "Cooperativa",
  OTHER: "Otra",
};
export function ReviewDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    adminApi<ReviewDetail>(`/institution-requests/${id}`, { signal: controller.signal })
      .then(setDetail)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e instanceof Error ? e.message : "No se pudo cargar el detalle.");
      });
    return () => controller.abort();
  }, [id, attempt, navigate]);
  useEffect(() => {
    if (decision) dialog.current?.showModal();
    else dialog.current?.close();
  }, [decision]);
  async function confirm() {
    if (!decision || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    try {
      const data = await adminApi<ReviewDetail>(`/institution-requests/${id}/${decision}`, {
        body: decision === "reject" && reason.trim() ? { reason: reason.trim() } : {},
      });
      setDetail(data);
      setNotice("Decisión registrada correctamente.");
      setDecision(null);
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
      else if (e instanceof AdminError && e.status === 409) {
        setDetail(null);
        setNotice(e.message);
        setDecision(null);
        setAttempt(attempt + 1);
      } else setNotice(e instanceof Error ? e.message : "No se pudo registrar la decisión.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (error)
    return (
      <div className="admin-empty">
        <p role="alert">{error}</p>
        <button
          className="button"
          onClick={() => {
            setError("");
            setAttempt(attempt + 1);
          }}
        >
          Reintentar
        </button>
        <Link to="/admin/solicitudes">Volver a solicitudes</Link>
      </div>
    );
  if (!detail)
    return (
      <>
        <p role="status">Cargando detalle...</p>
        {notice && <p role="alert">{notice}</p>}
      </>
    );
  const pending = detail.status === "PENDING_REVIEW" && !!detail.emailVerifiedAt;
  const plan = plans.find((item) => item.value === detail.planInterest)?.label ?? "No indicado";
  return (
    <>
      <nav className="admin-breadcrumb" aria-label="Ruta">
        <Link to="/admin/solicitudes">Solicitudes</Link>
        <span>/</span>
        <span>Detalle de solicitud</span>
      </nav>
      <header className="admin-detail-heading">
        <div>
          <h1>Detalle de solicitud</h1>
          <p>Información institucional y resolución.</p>
        </div>
        <span className={`admin-status admin-status-${detail.status}`}>{statusLabels[detail.status]}</span>
      </header>
      {notice && !decision && (
        <p className="admin-alert" role="status">
          {notice}
        </p>
      )}
      <section className="admin-summary">
        <div>
          <h2>{detail.institutionName}</h2>
          <p>NIT: {detail.taxId}</p>
          <p>Tipo de institución: {institutionLabels[detail.institutionType] ?? detail.institutionType}</p>
          <p>
            Plan de interés: <strong>{plan}</strong> <span className="admin-info-tag">Informativo</span>
          </p>
          <small>El plan definitivo se confirmará durante la contratación.</small>
        </div>
        <dl>
          <div>
            <dt>Nombre completo</dt>
            <dd>{detail.contactName}</dd>
          </div>
          <div>
            <dt>Cargo</dt>
            <dd>{detail.contactRole}</dd>
          </div>
          <div>
            <dt>Correo corporativo</dt>
            <dd>{detail.contactEmail}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{detail.contactPhone}</dd>
          </div>
        </dl>
      </section>
      <div className="admin-detail-grid">
        <section>
          <h2>
            <Building2 />
            Información de la institución
          </h2>
          <dl className="admin-data">
            <div>
              <dt>Nombre o razón social</dt>
              <dd>{detail.institutionName}</dd>
            </div>
            <div>
              <dt>NIT</dt>
              <dd>{detail.taxId}</dd>
            </div>
            <div>
              <dt>Tipo de institución</dt>
              <dd>{institutionLabels[detail.institutionType] ?? detail.institutionType}</dd>
            </div>
            <div>
              <dt>Plan de interés</dt>
              <dd>
                {plan} <small>Información comercial; no es un plan contratado.</small>
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h2>
            <MailCheck />
            Verificación de correo
          </h2>
          <div className={`admin-verification ${detail.emailVerifiedAt ? "is-verified" : ""}`}>
            <CheckCircle2 />
            <div>
              <strong>
                {detail.emailVerifiedAt
                  ? "Correo corporativo verificado"
                  : "Correo pendiente de verificación"}
              </strong>
              <p>
                {detail.emailVerifiedAt
                  ? `${displayDate(detail.emailVerifiedAt)} UTC`
                  : "La solicitud no está habilitada para resolución."}
              </p>
            </div>
          </div>
        </section>
        <section>
          <h2>
            <Clock3 />
            Resumen de la solicitud
          </h2>
          <dl className="admin-data">
            <div>
              <dt>Fecha de solicitud (UTC)</dt>
              <dd>{displayDate(detail.createdAt)}</dd>
            </div>
            <div>
              <dt>Estado actual</dt>
              <dd>{statusLabels[detail.status]}</dd>
            </div>
            {detail.reviewedAt && (
              <>
                <div>
                  <dt>Resuelta por</dt>
                  <dd>{detail.reviewer?.fullName ?? "No registrado"}</dd>
                </div>
                <div>
                  <dt>Fecha de decisión (UTC)</dt>
                  <dd>{displayDate(detail.reviewedAt)}</dd>
                </div>
              </>
            )}
            {detail.rejectionReason && (
              <div>
                <dt>Motivo de rechazo</dt>
                <dd>{detail.rejectionReason}</dd>
              </div>
            )}
          </dl>
        </section>
        <section>
          <h2>
            <Info />
            {detail.status === "APPROVED"
              ? "Solicitud aprobada"
              : detail.status === "REJECTED"
                ? "Solicitud rechazada"
                : "Qué ocurrirá al aprobar"}
          </h2>
          <p>
            {detail.status === "REJECTED"
              ? "Esta solicitud no puede continuar a contratación ni aprovisionamiento."
              : "La institución podrá continuar al proceso de contratación de DoggyCredit."}
          </p>
          <p className="admin-muted">
            Todavía no se crea el espacio institucional ni se activa una suscripción. El plan de interés sigue
            siendo informativo.
          </p>
        </section>
      </div>
      <footer className="admin-decision-bar">
        <Link className="button admin-secondary" to="/admin/solicitudes">
          <ArrowLeft size={19} />
          Volver a la lista
        </Link>
        {pending && (
          <div>
            <button
              className="button admin-danger"
              onClick={() => {
                setNotice("");
                setReason("");
                setDecision("reject");
              }}
            >
              <XCircle size={20} />
              Rechazar solicitud
            </button>
            <button
              className="button admin-approve"
              onClick={() => {
                setNotice("");
                setDecision("approve");
              }}
            >
              <CheckCircle2 size={20} />
              Aprobar solicitud
            </button>
          </div>
        )}
      </footer>
      {detail.status === "APPROVED" && <ContractingAccessAction key={detail.id} requestId={detail.id} />}
      <dialog
        ref={dialog}
        className="admin-dialog"
        aria-labelledby="decision-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setDecision(null);
        }}
      >
        <h2 id="decision-title">{decision === "approve" ? "Aprobar solicitud" : "Rechazar solicitud"}</h2>
        <p>¿Confirmas que deseas {decision === "approve" ? "aprobar" : "rechazar"} esta solicitud?</p>
        <p>
          La institución {decision === "approve" ? "podrá" : "no podrá"} continuar al proceso de contratación.
        </p>
        {decision === "reject" && (
          <label>
            Motivo de rechazo (opcional)
            <textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {notice && decision && (
          <p role="alert" className="admin-alert">
            {notice}
          </p>
        )}
        <div className="admin-dialog-actions">
          <button
            className="button admin-secondary"
            autoFocus
            disabled={busy}
            onClick={() => setDecision(null)}
          >
            Cancelar
          </button>
          <button
            className={`button ${decision === "approve" ? "admin-approve" : "admin-danger"}`}
            disabled={busy}
            onClick={confirm}
          >
            {busy ? "Registrando..." : "Confirmar decisión"}
          </button>
        </div>
      </dialog>
    </>
  );
}
