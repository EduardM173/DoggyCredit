import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { adminApi, AdminError } from "../admin/api";
import { InstitutionName } from "../admin/InstitutionName";
import { money, methods, paymentLabels, type Payment, type ProvisioningProgress } from "./api";
interface List {
  items: {
    id: string;
    institution: string;
    requestId: string;
    planName: string;
    amount: string;
    currency: string;
    status: string;
    createdAt: string;
    payments: Payment[];
    provisioning: ProvisioningProgress | null;
  }[];
  page: number;
  pageSize: number;
  total: number;
  paymentProvider: string;
}
export function AdminContractingsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<List | null>(null);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<{ id: string; result: string } | null>(null);
  const [recoveryId, setRecoveryId] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (choice) dialog.current?.showModal();
    else dialog.current?.close();
  }, [choice]);
  useEffect(() => {
    const controller = new AbortController();
    adminApi<List>(`/contractings?page=${page}`, { signal: controller.signal })
      .then(setData)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
      });
    return () => controller.abort();
  }, [page, version, navigate]);
  async function confirm() {
    if (!choice || busy) return;
    setBusy(true);
    setError("");
    try {
      await adminApi(`/contractings/payments/${choice.id}/simulate`, { body: { result: choice.result } });
      setChoice(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo simular el resultado.");
    } finally {
      setBusy(false);
    }
  }
  async function recover(id: string, action: "provisioning/retry" | "initial-invitation/resend") {
    if (busy) return;
    setBusy(true);
    setRecoveryId(id);
    setError("");
    setNotice("");
    try {
      const progress = await adminApi<ProvisioningProgress>(`/contractings/${id}/${action}`, { body: {} });
      setNotice(
        action === "provisioning/retry"
          ? progress.status === "COMPLETED"
            ? "La institución quedó preparada."
            : "El reintento quedó registrado; consulta el estado de recuperación."
          : progress.activation?.delivery === "SENT"
            ? "Invitación enviada al administrador inicial."
            : "El reenvío quedó registrado, pero la entrega aún no se confirmó. Consulta el estado.",
      );
      setVersion((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo recuperar el alta.");
    } finally {
      setBusy(false);
      setRecoveryId("");
    }
  }
  return (
    <>
      <div className="admin-page-heading">
        <h1>Contrataciones</h1>
        <p>Seguimiento de pagos, preparación y activación institucional.</p>
      </div>
      <section className="admin-list-toolbar" aria-label="Acciones de contrataciones">
        <button
          className="button admin-secondary"
          onClick={() => {
            setError("");
            setVersion((v) => v + 1);
          }}
        >
          <RefreshCw size={17} />
          Actualizar
        </button>
      </section>
      {error && (
        <p role="alert" className="admin-alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-alert admin-alert-info" role="status">
          {notice}
        </p>
      )}
      {!data && !error ? (
        <p className="admin-empty" role="status">
          Cargando contrataciones...
        </p>
      ) : (
        data && (
          <section className="admin-table-section" aria-label="Contrataciones institucionales">
            <div className="admin-table-scroll">
              <table className="admin-list-table">
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>Plan</th>
                    <th>Importe</th>
                    <th>Contratación</th>
                    <th>Intentos de pago</th>
                    <th>Alta institucional</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <InstitutionName name={row.institution}>
                          <Link className="admin-institution-link" to={`/admin/solicitudes/${row.requestId}`}>
                            {row.institution}
                          </Link>
                          <small>{new Date(row.createdAt).toLocaleString("es-BO")}</small>
                        </InstitutionName>
                      </td>
                      <td>{row.planName}</td>
                      <td>{money(row.amount, row.currency)}</td>
                      <td>
                        <span className={`admin-status admin-status-${row.status}`}>
                          {row.status === "CONFIRMED" ? "Confirmada" : "Pendiente de pago"}
                        </span>
                      </td>
                      <td>
                        {row.payments.length
                          ? row.payments.map((payment) => (
                              <div className="admin-payment-attempt" key={payment.id}>
                                <span className={`admin-status admin-status-${payment.status}`}>
                                  {paymentLabels[payment.status]}
                                </span>
                                <p>
                                  {methods[payment.method]} · {payment.reference}
                                </p>
                                {payment.status === "PENDING" &&
                                  payment.method === "BANK_TRANSFER" &&
                                  data.paymentProvider === "mock" && (
                                    <div className="admin-payment-actions">
                                      <button onClick={() => setChoice({ id: payment.id, result: "PAID" })}>
                                        Simular confirmación
                                      </button>
                                      <button onClick={() => setChoice({ id: payment.id, result: "FAILED" })}>
                                        Simular rechazo
                                      </button>
                                      <button
                                        onClick={() => setChoice({ id: payment.id, result: "CANCELLED" })}
                                      >
                                        Simular cancelación
                                      </button>
                                    </div>
                                  )}
                              </div>
                            ))
                          : "Sin pago registrado"}
                      </td>
                      <td>
                        {row.status !== "CONFIRMED" ? (
                          "Pendiente de pago"
                        ) : !row.provisioning ? (
                          "Preparación pendiente"
                        ) : (
                          <div className="admin-activation-status">
                            <strong className="admin-activation-title">
                              {row.provisioning.status === "COMPLETED"
                                ? row.provisioning.activation?.delivery === "ACTIVATED"
                                  ? "Lista para ingresar"
                                  : "Activación pendiente"
                                : row.provisioning.status.startsWith("FAILED")
                                  ? "Recuperación pendiente"
                                  : "Preparando institución"}
                            </strong>
                            {row.provisioning.tenant && <span>{row.provisioning.tenant.legalName}</span>}
                            {row.provisioning.errorCode && <span>Diagnóstico: {row.provisioning.errorCode}</span>}
                            {row.provisioning.activation &&
                              row.provisioning.activation.delivery !== "ACTIVATED" && (
                                <span className="admin-invitation-state">
                                  Administrador inicial · Invitación{" "}
                                  {
                                    (
                                      {
                                        QUEUED: "en envío",
                                        SENT: "enviada",
                                        EXPIRED: "vencida",
                                        FAILED: "fallida",
                                      } as Record<string, string>
                                    )[row.provisioning.activation.delivery]
                                  }
                                </span>
                              )}
                            {row.provisioning.status.startsWith("FAILED") && (
                              <button className="button admin-secondary admin-activation-action" disabled={busy} onClick={() => recover(row.id, "provisioning/retry")}>
                                <RefreshCw size={15} />{" "}
                                {recoveryId === row.id ? "Reintentando..." : "Reintentar preparación"}
                              </button>
                            )}
                            {row.provisioning.status === "COMPLETED" &&
                              row.provisioning.activation?.status === "INVITED" &&
                              ["SENT", "EXPIRED", "FAILED"].includes(
                                row.provisioning.activation.delivery,
                              ) && (
                                <button
                                  className="button admin-secondary admin-activation-action"
                                  disabled={busy}
                                  onClick={() => recover(row.id, "initial-invitation/resend")}
                                >
                                  <RefreshCw size={15} />{" "}
                                  {recoveryId === row.id ? "Reenviando..." : "Reenviar invitación"}
                                </button>
                              )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && <p className="admin-empty">No hay contrataciones registradas.</p>}
            <div className="admin-pagination">
              <span>{data.total} contrataciones</span>
              <nav aria-label="Paginación de contrataciones">
                <button
                  className="admin-icon-button"
                  aria-label="Página anterior"
                  title="Página anterior"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft />
                </button>
                <span>
                  Página {page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}
                </span>
                <button
                  className="admin-icon-button"
                  aria-label="Página siguiente"
                  title="Página siguiente"
                  disabled={page * 10 >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight />
                </button>
              </nav>
            </div>
          </section>
        )
      )}
      {choice && (
        <dialog
          ref={dialog}
          className="commerce-modal"
          aria-labelledby="simulate-heading"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setChoice(null);
          }}
        >
          <h2 id="simulate-heading">Confirmar simulación</h2>
          <p>
            El proveedor simulado registrará:{" "}
            {choice.result === "PAID"
              ? "pago confirmado"
              : choice.result === "FAILED"
                ? "pago rechazado"
                : "pago cancelado"}
            . No se procesa dinero real.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="button admin-secondary" disabled={busy} onClick={() => setChoice(null)}>
            Volver
          </button>
          <button className="button admin-primary" disabled={busy} onClick={confirm}>
            {busy ? "Procesando..." : "Confirmar simulación"}
          </button>
        </dialog>
      )}
    </>
  );
}
