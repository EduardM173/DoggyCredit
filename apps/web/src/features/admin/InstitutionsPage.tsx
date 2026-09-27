import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Search } from "lucide-react";
import { adminApi, AdminError, displayDate } from "./api";
import { InstitutionName } from "./InstitutionName";
interface InstitutionList {
  items: {
    tenantId: string;
    institutionName: string;
    nit: string;
    initialAdmin: { name: string; email: string };
    activationStatus: "INVITED" | "ACTIVE" | "SUSPENDED";
    approvedAt: string | null;
  }[];
  total: number;
  page: number;
  pageSize: number;
}
export function InstitutionsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<InstitutionList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const search = params.get("search") || "";
  const activationStatus = params.get("activationStatus") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = new URLSearchParams({ page: String(page), pageSize: "10" });
  if (search) query.set("search", search);
  if (activationStatus) query.set("activationStatus", activationStatus);
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    adminApi<InstitutionList>(`/institutions?${queryString}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e instanceof Error ? e.message : "No se pudieron cargar las instituciones.");
      });
    return () => controller.abort();
  }, [queryString, version, navigate]);
  function update(values: Record<string, string>) {
    setError("");
    setLoading(true);
    setVersion((v) => v + 1);
    setParams({ search, activationStatus, page: "1", ...values });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ search: String(new FormData(event.currentTarget).get("search") || "").trim() });
  }
  return (
    <>
      <div className="admin-page-heading">
        <h1>Instituciones</h1>
        <p>Revisa las instituciones aprobadas y la activación de su administrador inicial.</p>
      </div>
      <section className="admin-filters institutions-filters" aria-label="Filtros de instituciones">
        <form className="admin-search" onSubmit={submit}>
          <label className="sr-only" htmlFor="institution-search">
            Buscar por institución, NIT o administrador
          </label>
          <input
            id="institution-search"
            key={search}
            name="search"
            defaultValue={search}
            maxLength={180}
            placeholder="Buscar por institución, NIT o administrador..."
          />
          <button className="admin-icon-button" aria-label="Buscar" title="Buscar">
            <Search size={21} />
          </button>
        </form>
        <label>
          Activación
          <select
            aria-label="Activación"
            value={activationStatus}
            onChange={(e) => update({ activationStatus: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="INVITED">Invitación pendiente</option>
            <option value="ACTIVE">Cuenta activa</option>
          </select>
        </label>
      </section>
      {error ? (
        <div className="admin-empty">
          <p role="alert">{error}</p>
          <button className="button admin-secondary" onClick={() => update({ page: String(page) })}>
            Reintentar
          </button>
        </div>
      ) : loading ? (
        <p className="admin-empty" role="status">
          Cargando instituciones...
        </p>
      ) : (
        data && (
          <section className="admin-table-section" aria-label="Instituciones aprovisionadas">
            <div className="admin-table-scroll">
              <table className="admin-list-table">
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>NIT</th>
                    <th>Administrador inicial</th>
                    <th>Activación</th>
                    <th aria-sort="descending">Fecha de aprobación (UTC) ↓</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.tenantId}>
                      <td>
                        <InstitutionName name={row.institutionName} />
                      </td>
                      <td>{row.nit}</td>
                      <td>
                        <span>{row.initialAdmin.name}</span>
                        <small className="institution-email">{row.initialAdmin.email}</small>
                      </td>
                      <td>
                        <span className={`admin-status activation-${row.activationStatus}`}>
                          {row.activationStatus === "ACTIVE" ? (
                            <CheckCircle2 size={17} />
                          ) : (
                            <Clock3 size={17} />
                          )}{" "}
                          {row.activationStatus === "ACTIVE"
                            ? "Cuenta activa"
                            : row.activationStatus === "INVITED"
                              ? "Invitación pendiente"
                              : "Acceso suspendido"}
                        </span>
                      </td>
                      <td>{row.approvedAt ? displayDate(row.approvedAt) : "No registrada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <p className="admin-empty">No hay instituciones que coincidan con la búsqueda.</p>
            )}
            <div className="admin-pagination">
              <span>
                {data.total} {data.total === 1 ? "institución" : "instituciones"}
              </span>
              <nav aria-label="Paginación de instituciones">
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
                  Página {page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}
                </span>
                <button
                  className="admin-icon-button"
                  aria-label="Página siguiente"
                  title="Página siguiente"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  <ChevronRight />
                </button>
              </nav>
            </div>
          </section>
        )
      )}
    </>
  );
}
