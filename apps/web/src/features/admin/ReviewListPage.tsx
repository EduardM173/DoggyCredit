import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, FilterX, Search } from "lucide-react";
import { plans } from "../institution-requests/api";
import { adminApi, AdminError, displayDate, statusLabels, type ReviewList, type Status } from "./api";

export function ReviewListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<ReviewList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const search = params.get("search") || "";
  const status = params.get("status") ?? "PENDING_REVIEW";
  const date = params.get("date") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = new URLSearchParams({ search, status, date, page: String(page), pageSize: "10" });
  for (const key of ["search", "status", "date"]) if (!query.get(key)) query.delete(key);
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    adminApi<ReviewList>(`/institution-requests?${queryString}`, { signal: controller.signal })
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
      });
    return () => controller.abort();
  }, [queryString, navigate, attempt]);
  function update(values: Record<string, string>) {
    setLoading(true);
    setError("");
    setAttempt((value) => value + 1);
    setParams({ search, status, date, page: "1", ...values });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ search: String(new FormData(event.currentTarget).get("search") || "").trim() });
  }
  return (
    <>
      <div className="admin-page-heading">
        <h1>Solicitudes</h1>
        <p>Solicitudes institucionales de DoggyCredit.</p>
      </div>
      <section className="admin-filters" aria-label="Filtros">
        <form onSubmit={submit} className="admin-search">
          <label className="sr-only" htmlFor="review-search">
            Buscar por institución, NIT o correo
          </label>
          <input
            key={search}
            id="review-search"
            name="search"
            defaultValue={search}
            maxLength={180}
            placeholder="Buscar por institución, NIT o correo..."
          />
          <button className="admin-icon-button" title="Buscar" aria-label="Buscar">
            <Search size={21} />
          </button>
        </form>
        <label>
          Estado
          <select value={status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Todos los estados</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha de solicitud (UTC)
          <input type="date" value={date} onChange={(e) => update({ date: e.target.value })} />
        </label>
        <button
          className="button admin-secondary"
          onClick={() => update({ search: "", status: "", date: "" })}
        >
          <FilterX size={18} />
          Limpiar filtros
        </button>
      </section>
      {error ? (
        <div className="admin-empty">
          <p role="alert">{error}</p>
          <button
            className="button"
            onClick={() => {
              setError("");
              setLoading(true);
              setAttempt(attempt + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      ) : loading ? (
        <p className="admin-empty" role="status">
          Cargando solicitudes...
        </p>
      ) : (
        result && (
          <section className="admin-table-section" aria-label="Solicitudes institucionales">
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>NIT</th>
                    <th>Correo de contacto</th>
                    <th>Plan de interés</th>
                    <th>Estado</th>
                    <th>Fecha (UTC)</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.institutionName}</strong>
                      </td>
                      <td>{item.taxId}</td>
                      <td>{item.contactEmail}</td>
                      <td>
                        {plans.find((plan) => plan.value === item.planInterest)?.label ?? "No indicado"}
                        <small>Informativo</small>
                      </td>
                      <td>
                        <span className={`admin-status admin-status-${item.status}`}>
                          {statusLabels[item.status as Status]}
                        </span>
                      </td>
                      <td>{displayDate(item.createdAt)}</td>
                      <td>
                        <Link className="admin-detail-link" to={`/admin/solicitudes/${item.id}`}>
                          Ver detalle
                          <ArrowRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.items.length === 0 && (
              <p className="admin-empty">No hay solicitudes con estos filtros.</p>
            )}
            <footer className="admin-pagination">
              <span>
                {result.total === 0
                  ? "0 solicitudes"
                  : `Mostrando ${result.items.length ? (result.page - 1) * result.pageSize + 1 : 0} a ${Math.min(result.page * result.pageSize, result.total)} de ${result.total} solicitudes`}
              </span>
              <nav aria-label="Paginación">
                <button
                  className="admin-icon-button"
                  aria-label="Página anterior"
                  title="Página anterior"
                  disabled={page <= 1}
                  onClick={() => update({ page: String(page - 1) })}
                >
                  <ChevronLeft />
                </button>
                <span>
                  Página {page} de {Math.max(1, result.totalPages)}
                </span>
                <button
                  className="admin-icon-button"
                  aria-label="Página siguiente"
                  title="Página siguiente"
                  disabled={page >= result.totalPages}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  <ChevronRight />
                </button>
              </nav>
            </footer>
          </section>
        )
      )}
    </>
  );
}
