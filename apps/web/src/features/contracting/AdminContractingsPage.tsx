import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { adminApi, AdminError } from "../admin/api";
import { money, methods, paymentLabels, type Payment } from "./api";
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
  return (
    <>
      <div className="admin-page-heading">
        <h1>Contrataciones</h1>
        <p>Planes confirmados y seguimiento de pagos.</p>
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
      </div>
      {error && (
        <p role="alert" className="admin-alert">
          {error}
        </p>
      )}
      {!data && !error ? (
        <p role="status">Cargando contrataciones...</p>
      ) : (
        data && (
          <>
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>Plan</th>
                    <th>Importe</th>
                    <th>Contratación</th>
                    <th>Intentos de pago</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link to={`/admin/solicitudes/${row.requestId}`}>{row.institution}</Link>
                        <small>{new Date(row.createdAt).toLocaleString("es-BO")}</small>
                      </td>
                      <td>{row.planName}</td>
                      <td>{money(row.amount, row.currency)}</td>
                      <td>{row.status === "CONFIRMED" ? "Confirmada" : "Pendiente de pago"}</td>
                      <td>
                        {row.payments.length
                          ? row.payments.map((payment) => (
                              <div className="admin-payment-attempt" key={payment.id}>
                                <strong>{paymentLabels[payment.status]}</strong>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && <p>No hay contrataciones registradas.</p>}
            <div className="admin-pagination">
              <span>{data.total} contrataciones</span>
              <button
                className="admin-icon-button"
                aria-label="Página anterior"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </button>
              <span>Página {page}</span>
              <button
                className="admin-icon-button"
                aria-label="Página siguiente"
                disabled={page * 10 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </button>
            </div>
          </>
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
