import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, RefreshCw, X } from "lucide-react";
import { adminApi, AdminError } from "./api";
import "./platform-plans.css";

type LimitMode = "NO_CONFIGURADO" | "LIMITADO" | "ILIMITADO";
type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string | null;
  currency: string | null;
  billingPeriod: string | null;
  requiresPayment: boolean | null;
  evaluationLimitMode: LimitMode;
  evaluationsPerMonth: number | null;
  maxUsers: number | null;
  features: string[];
  active: boolean;
  isPublic: boolean;
  revision: number;
  effectiveFrom: string;
};
type Draft = {
  code: string;
  name: string;
  description: string;
  price: string;
  currency: "BOB";
  billingPeriod: "MONTHLY";
  requiresPayment: boolean;
  evaluationLimitMode: LimitMode;
  evaluationsPerMonth: string;
  maxUsers: string;
  features: string;
};
const blank: Draft = {
  code: "",
  name: "",
  description: "",
  price: "0.00",
  currency: "BOB",
  billingPeriod: "MONTHLY",
  requiresPayment: false,
  evaluationLimitMode: "NO_CONFIGURADO",
  evaluationsPerMonth: "",
  maxUsers: "",
  features: "",
};
function draftOf(plan: Plan): Draft {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "",
    price: plan.price ?? "0.00",
    currency: "BOB",
    billingPeriod: "MONTHLY",
    requiresPayment: Boolean(plan.requiresPayment),
    evaluationLimitMode: plan.evaluationLimitMode,
    evaluationsPerMonth: String(plan.evaluationsPerMonth ?? ""),
    maxUsers: String(plan.maxUsers ?? ""),
    features: plan.features.join("\n"),
  };
}

export function PlatformPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [statusTarget, setStatusTarget] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    adminApi<Plan[]>("/platform/plans", { signal: controller.signal })
      .then((items) => {
        setPlans(items);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "No se pudo cargar el catálogo.");
      });
    return () => controller.abort();
  }, [refresh]);

  function openEditor(plan?: Plan) {
    setEditing(plan ?? "new");
    setDraft(plan ? draftOf(plan) : blank);
    setError("");
    setNotice("");
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setError("");
    setBusy(true);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price: draft.price,
      currency: draft.currency,
      billingPeriod: draft.billingPeriod,
      requiresPayment: draft.requiresPayment,
      evaluationLimitMode: draft.evaluationLimitMode,
      evaluationsPerMonth:
        draft.evaluationLimitMode === "LIMITADO" ? Number(draft.evaluationsPerMonth) : null,
      maxUsers: draft.maxUsers ? Number(draft.maxUsers) : null,
      features: draft.features
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
    try {
      if (editing === "new")
        await adminApi("/platform/plans", { body: { ...body, code: draft.code.trim().toUpperCase() } });
      else
        await adminApi(`/platform/plans/${editing.id}`, {
          body: { ...body, expectedRevision: editing.revision },
        });
      setEditing(null);
      setNotice("Plan guardado. Actívalo cuando esté listo para ofrecerse.");
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof AdminError && reason.status === 409
          ? "El plan cambió o el código ya existe. Actualiza la lista antes de reintentar; tus datos siguen aquí."
          : reason instanceof Error
            ? reason.message
            : "No se pudo guardar el plan.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus() {
    if (!statusTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      await adminApi(`/platform/plans/${statusTarget.id}/status`, {
        body: { active: !statusTarget.active, expectedRevision: statusTarget.revision },
      });
      setNotice(
        statusTarget.active
          ? "Plan desactivado para futuras contrataciones."
          : "Plan disponible para nuevas contrataciones.",
      );
      setStatusTarget(null);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof AdminError && reason.status === 409
          ? "El plan cambió. Actualiza la lista antes de intentarlo de nuevo."
          : reason instanceof Error
            ? reason.message
            : "No se pudo cambiar el estado.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="platform-plans">
      <header className="platform-plans-heading">
        <div>
          <h1>Planes del SaaS</h1>
          <p>Oferta comercial de DoggyCredit para nuevas instituciones.</p>
        </div>
        <div className="platform-plans-actions">
          <button
            type="button"
            className="platform-plans-secondary"
            onClick={() => setRefresh((value) => value + 1)}
            title="Actualizar planes"
          >
            <RefreshCw size={18} /> Actualizar
          </button>
          <button type="button" className="button" onClick={() => openEditor()}>
            <Plus size={18} /> Crear plan
          </button>
        </div>
      </header>
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-alert admin-alert-info" role="status">
          {notice}
        </p>
      )}
      {!plans && !error && <p role="status">Cargando planes...</p>}
      {plans?.length === 0 && (
        <p className="platform-plans-empty">No hay planes. Crea uno y actívalo para publicarlo.</p>
      )}
      {plans && plans.length > 0 && (
        <div className="platform-plans-scroll">
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Precio</th>
                <th>Capacidad</th>
                <th>Estado</th>
                <th>Vigente desde</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <strong>{plan.name}</strong>
                    <small>{plan.code}</small>
                  </td>
                  <td>
                    {plan.price ?? "Sin precio"} {plan.currency ?? ""}
                    <small>
                      {plan.billingPeriod === "MONTHLY" ? "Mensual" : (plan.billingPeriod ?? "Sin período")}
                    </small>
                  </td>
                  <td>
                    {plan.evaluationLimitMode === "LIMITADO"
                      ? `${plan.evaluationsPerMonth} evaluaciones/mes`
                      : plan.evaluationLimitMode === "ILIMITADO"
                        ? "Sin límite configurado"
                        : "No configurada"}
                    <small>
                      {plan.maxUsers ? `Hasta ${plan.maxUsers} usuarios` : "Usuarios: no configurado"}
                    </small>
                  </td>
                  <td>
                    <span className={`platform-plans-state ${plan.active && plan.isPublic ? "on" : "off"}`}>
                      {plan.active && plan.isPublic ? "Disponible" : "Inactivo"}
                    </span>
                  </td>
                  <td>{new Date(plan.effectiveFrom).toLocaleString("es-BO")}</td>
                  <td>
                    <div className="platform-plans-actions">
                      <button
                        type="button"
                        className="platform-plans-secondary"
                        onClick={() => openEditor(plan)}
                      >
                        <Pencil size={16} /> Editar
                      </button>
                      <button
                        type="button"
                        className={plan.active ? "platform-plans-danger" : "platform-plans-secondary"}
                        onClick={() => setStatusTarget(plan)}
                      >
                        {plan.active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div
          className="platform-plans-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEditing(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-editor-title"
            className="platform-plans-dialog"
          >
            <button
              type="button"
              className="platform-plans-close"
              onClick={() => setEditing(null)}
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
            <h2 id="plan-editor-title">{editing === "new" ? "Crear plan" : `Editar ${editing.name}`}</h2>
            <form onSubmit={save}>
              {editing === "new" && (
                <label>
                  Código{" "}
                  <input
                    value={draft.code}
                    onChange={(e) => update("code", e.target.value.toUpperCase())}
                    required
                    pattern="[A-Z][A-Z0-9_]{1,49}"
                    maxLength={50}
                  />
                </label>
              )}
              <label>
                Nombre{" "}
                <input
                  value={draft.name}
                  onChange={(e) => update("name", e.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Descripción{" "}
                <textarea
                  value={draft.description}
                  onChange={(e) => update("description", e.target.value)}
                  maxLength={500}
                />
              </label>
              <div className="platform-plans-grid">
                <label>
                  Precio (Bs){" "}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => update("price", e.target.value)}
                    required
                    pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                  />
                </label>
                <label>
                  Moneda{" "}
                  <select value={draft.currency} onChange={() => undefined}>
                    <option value="BOB">BOB</option>
                  </select>
                </label>
              </div>
              <div className="platform-plans-grid">
                <label>
                  Período{" "}
                  <select value={draft.billingPeriod} onChange={() => undefined}>
                    <option value="MONTHLY">Mensual</option>
                  </select>
                </label>
                <label className="platform-plans-check">
                  <input
                    type="checkbox"
                    checked={draft.requiresPayment}
                    onChange={(e) => update("requiresPayment", e.target.checked)}
                  />{" "}
                  Requiere pago
                </label>
              </div>
              <div className="platform-plans-grid">
                <label>
                  Evaluaciones{" "}
                  <select
                    value={draft.evaluationLimitMode}
                    onChange={(e) => update("evaluationLimitMode", e.target.value as LimitMode)}
                  >
                    <option value="NO_CONFIGURADO">No configurado</option>
                    <option value="LIMITADO">Límite mensual</option>
                    <option value="ILIMITADO">Ilimitado</option>
                  </select>
                </label>
                {draft.evaluationLimitMode === "LIMITADO" && (
                  <label>
                    Límite mensual{" "}
                    <input
                      type="number"
                      min="1"
                      max="1000000"
                      required
                      value={draft.evaluationsPerMonth}
                      onChange={(e) => update("evaluationsPerMonth", e.target.value)}
                    />
                  </label>
                )}
              </div>
              <label>
                Máximo de usuarios (opcional){" "}
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  value={draft.maxUsers}
                  onChange={(e) => update("maxUsers", e.target.value)}
                />
              </label>
              <label>
                Características visibles (una por línea){" "}
                <textarea
                  value={draft.features}
                  onChange={(e) => update("features", e.target.value)}
                  rows={3}
                />
              </label>
              <p>Los cambios aplican a nuevas contrataciones; no modifican suscripciones anteriores.</p>
              <div className="platform-plans-dialog-actions">
                <button type="button" className="platform-plans-secondary" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button type="submit" className="button" disabled={busy}>
                  Guardar
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {statusTarget && (
        <div className="platform-plans-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-status-title"
            className="platform-plans-dialog"
          >
            <h2 id="plan-status-title">
              {statusTarget.active ? "Desactivar" : "Activar"} {statusTarget.name}
            </h2>
            <p>
              {statusTarget.active
                ? "Este plan dejará de estar disponible para nuevas contrataciones. Las suscripciones existentes conservarán sus condiciones."
                : "El plan aparecerá en la oferta para nuevas contrataciones si su configuración es válida."}
            </p>
            <div className="platform-plans-dialog-actions">
              <button
                type="button"
                className="platform-plans-secondary"
                onClick={() => setStatusTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={statusTarget.active ? "platform-plans-danger" : "button"}
                onClick={changeStatus}
                disabled={busy}
              >
                {statusTarget.active ? "Desactivar plan" : "Activar plan"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
