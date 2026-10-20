import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MailPlus, RefreshCw, ShieldCheck, ShieldOff, UserX, X } from "lucide-react";
import { adminApi, AdminError } from "./api";
import "./platform-team.css";

type TeamMember = {
  id: string;
  fullName: string;
  email: string;
  role: "OPERATOR" | "PLATFORM_ADMIN";
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "REVOKED" | "BLOCKED";
  invitation: { expiresAt: string; sentAt: string | null; sendErrorCode: string | null } | null;
};
type Action =
  { kind: "invite" } | { kind: "resend" | "suspend" | "revoke" | "reactivate"; member: TeamMember };

export function PlatformTeamPage() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    adminApi<TeamMember[]>("/platform/team", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setMembers(data);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof AdminError && reason.status === 401)
          navigate("/admin/login", { replace: true });
        else setError(reason instanceof Error ? reason.message : "No se pudo cargar el equipo.");
      });
    return () => controller.abort();
  }, [navigate, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action.kind === "invite") {
        const result = await adminApi<{ delivery: string }>("/platform/team/invitations", {
          body: { email, fullName },
        });
        setNotice(
          result.delivery === "FAILED"
            ? "No se pudo enviar el correo. Puedes reenviar la invitación desde la lista."
            : "El servicio de correo aceptó la invitación; la activación sigue pendiente.",
        );
      } else if (action.kind === "resend") {
        const result = await adminApi<{ delivery: string }>(`/platform/team/${action.member.id}/resend`, {
          body: {},
        });
        setNotice(
          result.delivery === "FAILED"
            ? "El reenvío falló. Intenta nuevamente."
            : "El servicio de correo aceptó el nuevo enlace. El anterior ya no sirve.",
        );
      } else {
        await adminApi(`/platform/team/${action.member.id}/${action.kind}`, { body: {} });
        setNotice(
          action.kind === "suspend"
            ? "Acceso interno suspendido y sesiones cerradas."
            : action.kind === "reactivate"
              ? "Operador reactivado. Debe iniciar una sesión nueva."
              : "Acceso interno revocado y sesiones cerradas.",
        );
      }
      setAction(null);
      setEmail("");
      setFullName("");
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar la operación.");
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-team">
      <div className="platform-team-heading">
        <div>
          <h1>Equipo interno</h1>
          <p>Accesos del personal de Doggy Software.</p>
        </div>
        <button className="button" onClick={() => setAction({ kind: "invite" })}>
          <MailPlus size={18} /> Invitar operador
        </button>
      </div>
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
      {!members && !error && <p role="status">Cargando equipo...</p>}
      {members?.length === 0 && (
        <p className="platform-team-empty">Todavía no hay operadores. Invita al primero para comenzar.</p>
      )}
      {members && members.length > 0 && (
        <div className="platform-team-scroll">
          <table>
            <thead>
              <tr>
                <th>Persona</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const pending = member.status === "INVITED";
                const delivery = member.invitation?.sendErrorCode
                  ? "Envío fallido"
                  : member.invitation?.sentAt
                    ? "Aceptado por correo"
                    : "Pendiente de envío";
                return (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.fullName}</strong>
                    </td>
                    <td>{member.email}</td>
                    <td>{member.role === "PLATFORM_ADMIN" ? "Administrador de plataforma" : "Operador"}</td>
                    <td>
                      <span className={`platform-team-status ${member.status.toLowerCase()}`}>
                        {pending
                          ? `Invitación pendiente · ${delivery}`
                          : member.status === "ACTIVE"
                            ? "Activo"
                            : member.status === "SUSPENDED"
                              ? "Suspendido"
                              : member.status === "BLOCKED"
                                ? "Bloqueado"
                                : "Revocado"}
                      </span>
                    </td>
                    <td>
                      <div className="platform-team-actions">
                        {member.role === "OPERATOR" && pending && (
                          <button
                            onClick={() => setAction({ kind: "resend", member })}
                            title="Reenviar invitación"
                          >
                            <RefreshCw size={16} /> Reenviar
                          </button>
                        )}
                        {member.role === "OPERATOR" && member.status === "ACTIVE" && (
                          <button onClick={() => setAction({ kind: "suspend", member })}>
                            <ShieldOff size={16} /> Suspender
                          </button>
                        )}
                        {member.role === "OPERATOR" && member.status === "SUSPENDED" && (
                          <button onClick={() => setAction({ kind: "reactivate", member })}>
                            <ShieldCheck size={16} /> Reactivar
                          </button>
                        )}
                        {member.role === "OPERATOR" && (member.status === "ACTIVE" || pending) && (
                          <button
                            className="platform-team-danger"
                            onClick={() => setAction({ kind: "revoke", member })}
                          >
                            <UserX size={16} /> Revocar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {action && (
        <div
          className="platform-team-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setAction(null);
          }}
        >
          <section
            className="platform-team-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-dialog-title"
          >
            <button
              className="platform-team-close"
              type="button"
              aria-label="Cerrar"
              onClick={() => setAction(null)}
              disabled={busy}
            >
              <X size={20} />
            </button>
            <h2 id="team-dialog-title">
              {action.kind === "invite"
                ? "Invitar operador"
                : action.kind === "resend"
                  ? "Reenviar invitación"
                  : action.kind === "suspend"
                    ? "Suspender acceso"
                    : action.kind === "reactivate"
                      ? "Reactivar acceso"
                      : "Revocar acceso"}
            </h2>
            <form onSubmit={submit}>
              {action.kind === "invite" ? (
                <>
                  <label htmlFor="team-name">Nombre completo</label>
                  <input
                    id="team-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    minLength={2}
                    maxLength={160}
                    required
                    autoFocus
                  />
                  <label htmlFor="team-email">Correo electrónico</label>
                  <input
                    id="team-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    maxLength={254}
                    required
                  />
                  <p>
                    Rol: <strong>Operador</strong>. El acceso se concede solo al aceptar el enlace.
                  </p>
                </>
              ) : (
                <p>
                  {action.member.fullName} · {action.member.email}
                  <br />
                  {action.kind === "resend"
                    ? "El enlace anterior dejará de funcionar."
                    : action.kind === "suspend"
                      ? "Se cerrarán sus sesiones internas. Sus accesos institucionales no cambiarán."
                      : action.kind === "reactivate"
                        ? "Podrá iniciar una nueva sesión interna. Sus sesiones anteriores seguirán cerradas."
                        : "El acceso interno quedará revocado. No se eliminará su identidad ni su historial."}
                </p>
              )}
              <div className="platform-team-dialog-actions">
                <button type="button" onClick={() => setAction(null)} disabled={busy}>
                  Cancelar
                </button>
                <button
                  className={action.kind === "revoke" ? "platform-team-danger-button" : "button"}
                  type="submit"
                  disabled={busy}
                >
                  {busy
                    ? "Procesando..."
                    : action.kind === "invite"
                      ? "Enviar invitación"
                      : action.kind === "resend"
                        ? "Reenviar invitación"
                        : action.kind === "suspend"
                          ? "Suspender acceso"
                          : action.kind === "reactivate"
                            ? "Reactivar acceso"
                            : "Revocar acceso"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
