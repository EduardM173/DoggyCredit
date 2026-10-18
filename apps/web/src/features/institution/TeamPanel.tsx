import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock3, Mail, Plus, Send, Users, X } from "lucide-react";
import "./team.css";

type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: "INSTITUTION_ADMIN" | "ANALYST";
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "REVOKED";
  isInitialAdmin: boolean;
  invitation: {
    id: string;
    sentAt: string | null;
    expiresAt: string;
    lastSendErrorCode: string | null;
  } | null;
};
type Team = {
  tenant: { name: string; slug: string };
  actorMembershipId?: string;
  members: TeamMember[];
  counts?: Partial<Record<TeamMember["status"], number>>;
  page?: number;
  pageCount?: number;
  total?: number;
};
type TeamMutation = { emailSent: boolean; emailDelivery?: "SENT" | "TEST_INBOX" | "FAILED"; team: Team };

async function teamApi<T>(slug: string, path = "", body?: object): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/institution/tenants/${encodeURIComponent(slug)}/team${path}`, {
    credentials: "include",
    cache: "no-store",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DoggyCredit-Institution": "1" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const fallback =
      response.status === 401
        ? "Tu sesión terminó. Inicia sesión nuevamente."
        : response.status === 403
          ? "No tienes permiso para administrar este equipo."
          : response.status === 404
            ? "La invitación ya no está disponible."
            : "No se pudo completar la operación. Intenta nuevamente.";
    throw new Error(
      response.status === 409 && typeof payload.message === "string" ? payload.message : fallback,
    );
  }
  return response.json();
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export function TeamPanel({ slug, tenantName }: { slug: string; tenantName: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ANALYST" | "INSTITUTION_ADMIN">("ANALYST");
  const [choice, setChoice] = useState<{
    member: TeamMember;
    action: "cancel" | "suspend" | "reactivate" | "revoke";
  } | null>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const choiceDialog = useRef<HTMLDivElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    teamApi<Team>(slug, `?page=${page}`)
      .then((value) => {
        if (active) {
          setTeam(value);
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [slug, reload, page]);

  useEffect(() => {
    if (!modal) return;
    emailInput.current?.focus();
    const trigger = inviteButton.current;
    return () => trigger?.focus();
  }, [modal]);

  useEffect(() => {
    if (choice) choiceDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [choice]);

  function dialogKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      if (choice) setChoice(null);
      else setModal(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...((choice ? choiceDialog : dialog).current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      ) ?? []),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await teamApi<TeamMutation>(slug, "/invitations", { email, role: inviteRole });
      setTeam(response.team);
      setPage(1);
      setNotice(
        response.emailSent
          ? response.emailDelivery === "TEST_INBOX"
            ? `La invitación se generó en la bandeja de pruebas local para ${email.trim().toLowerCase()}; no se envió a una casilla externa.`
            : `Invitación enviada a ${email.trim().toLowerCase()}. El analista debe abrir el enlace para activar su acceso.`
          : `La invitación quedó pendiente, pero el correo aún no salió. Puedes reenviarlo desde Equipo.`,
      );
      setModal(false);
      setEmail("");
      setInviteRole("ANALYST");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo enviar la invitación.");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function resend(invitationId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setResending(invitationId);
    setError("");
    setNotice("");
    try {
      const response = await teamApi<TeamMutation>(
        slug,
        `/invitations/${encodeURIComponent(invitationId)}/resend`,
        {},
      );
      setTeam(response.team);
      setPage(1);
      setNotice(
        response.emailSent
          ? response.emailDelivery === "TEST_INBOX"
            ? "La nueva invitación está en la bandeja de pruebas local. El enlace anterior ya no es válido."
            : "Invitación reenviada. El enlace anterior ya no es válido."
          : "El correo sigue pendiente. Puedes intentar reenviarlo más tarde.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo reenviar la invitación.");
      setReload((value) => value + 1);
    } finally {
      inFlight.current = false;
      setResending(null);
    }
  }

  async function change() {
    if (!choice || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await teamApi<Team>(
        slug,
        `/members/${encodeURIComponent(choice.member.id)}/${choice.action}`,
        {},
      );
      setTeam(result);
      setPage(1);
      setNotice("El acceso institucional se actualizó.");
      setChoice(null);
    } catch (reason) {
      const expected =
        choice.action === "reactivate" ? "ACTIVE" : choice.action === "suspend" ? "SUSPENDED" : "REVOKED";
      try {
        const latest = await teamApi<Team>(slug, `?page=${page}`);
        setTeam(latest);
        if (latest.members.find((member) => member.id === choice.member.id)?.status === expected) {
          setNotice("El estado guardado confirma el cambio de acceso.");
        } else {
          setError(
            reason instanceof Error
              ? `El estado cambió o no se confirmó. ${reason.message}`
              : "El estado cambió o no se confirmó. Revisa el equipo.",
          );
        }
      } catch {
        setError(
          "No se pudo confirmar el estado guardado. Reintenta la consulta antes de repetir la acción.",
        );
      }
      setChoice(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="institution-dashboard team-page">
      <div className="institution-breadcrumb">
        <Link to={`/${slug}`}>Inicio</Link>
        <ArrowRight size={16} /> Equipo
      </div>
      <p className="institution-eyebrow">EQUIPO</p>
      <h1>Administra el equipo de {tenantName}</h1>
      <p className="institution-lead">Gestiona las personas con acceso a tu institución.</p>
      <section className="team-section">
        <div className="team-heading">
          <div>
            <h2>Equipo</h2>
            <p>
              {team
                ? `${team.counts?.ACTIVE ?? team.members.filter((member) => member.status === "ACTIVE").length} personas con acceso · ${team.counts?.INVITED ?? team.members.filter((member) => member.status === "INVITED").length} invitaciones · ${team.counts?.SUSPENDED ?? 0} suspendidos · ${team.counts?.REVOKED ?? 0} revocados`
                : "Cargando equipo..."}
            </p>
          </div>
          <div className="team-heading-actions">
            <button
              ref={inviteButton}
              className="institution-primary"
              onClick={() => {
                setError("");
                setInviteRole("ANALYST");
                setModal(true);
              }}
            >
              <Plus size={20} /> Invitar analista
            </button>
            <button
              className="team-resend"
              onClick={() => {
                setInviteRole("INSTITUTION_ADMIN");
                setModal(true);
              }}
            >
              <Plus size={17} /> Invitar reemplazo administrativo
            </button>
          </div>
        </div>
        {notice && (
          <p className="team-notice" role="status">
            <CheckCircle2 size={22} /> {notice}
          </p>
        )}
        {error && !modal && (
          <p className="institution-error" role="alert">
            {error} <button onClick={() => setReload((value) => value + 1)}>Reintentar</button>
          </p>
        )}
        {team && (
          <>
            <div className="team-table" role="table" aria-label="Personas e invitaciones de la institución">
              <div className="team-table-head" role="row">
                <span role="columnheader">Usuario</span>
                <span role="columnheader">Correo</span>
                <span role="columnheader">Rol</span>
                <span role="columnheader">Estado</span>
                <span role="columnheader">Acciones</span>
              </div>
              {team.members.map((member) => (
                <div className="team-row" role="row" key={member.id}>
                  <div className="team-identity" role="cell">
                    <span className="team-avatar">
                      {member.status === "ACTIVE" ? (
                        initials(member.name ?? member.email)
                      ) : (
                        <Mail size={21} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {member.status === "INVITED" ? "Invitación pendiente" : (member.name ?? member.email)}
                      </strong>
                      {member.status === "INVITED" && <small>Aún no activó su acceso.</small>}
                    </div>
                  </div>
                  <span role="cell" className="team-email">
                    {member.email}
                  </span>
                  <span role="cell">
                    {member.role === "ANALYST"
                      ? "Analista"
                      : member.isInitialAdmin
                        ? "Administrador inicial"
                        : "Administrador"}
                  </span>
                  <span role="cell">
                    <span className={`team-status ${member.status.toLowerCase()}`}>
                      {member.status === "ACTIVE" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
                      {member.status === "ACTIVE"
                        ? "Activo"
                        : member.status === "SUSPENDED"
                          ? "Suspendido"
                          : member.status === "REVOKED"
                            ? "Revocado"
                            : member.invitation?.sentAt
                              ? "Invitación pendiente"
                              : "Envío pendiente"}
                    </span>
                  </span>
                  <span role="cell">
                    <span className="team-actions">
                      {member.status === "INVITED" && member.invitation && (
                        <button
                          className="team-resend"
                          disabled={busy || resending !== null}
                          onClick={() => resend(member.invitation!.id)}
                        >
                          <Send size={17} /> Reenviar
                        </button>
                      )}
                      {member.status === "INVITED" && (
                        <button
                          className="team-resend"
                          disabled={busy}
                          onClick={() => setChoice({ member, action: "cancel" })}
                        >
                          Cancelar
                        </button>
                      )}
                      {member.role === "ANALYST" && member.status === "ACTIVE" && (
                        <button
                          className="team-resend"
                          disabled={busy}
                          onClick={() => setChoice({ member, action: "suspend" })}
                        >
                          Suspender
                        </button>
                      )}
                      {member.role === "ANALYST" && member.status === "SUSPENDED" && (
                        <button
                          className="team-resend"
                          disabled={busy}
                          onClick={() => setChoice({ member, action: "reactivate" })}
                        >
                          Reactivar
                        </button>
                      )}
                      {(member.status === "ACTIVE" || member.status === "SUSPENDED") &&
                        member.id !== team.actorMembershipId && (
                          <button
                            className="team-resend"
                            disabled={busy}
                            onClick={() => setChoice({ member, action: "revoke" })}
                          >
                            Revocar
                          </button>
                        )}
                      {member.status === "REVOKED" && <span className="team-dash">—</span>}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            {(team.pageCount ?? 1) > 1 && (
              <nav className="team-pagination" aria-label="Páginas del equipo">
                <button className="team-resend" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Anterior
                </button>
                <span>
                  Página {team.page ?? page} de {team.pageCount}
                </span>
                <button
                  className="team-resend"
                  disabled={page >= (team.pageCount ?? 1)}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </button>
              </nav>
            )}
            {!team.members.some((member) => member.role === "ANALYST" && member.status === "ACTIVE") && (
              <div className="team-empty">
                <Users size={32} />
                <strong>Todavía no hay analistas activos.</strong>
                <p>Invita a un analista para que pueda comenzar a realizar evaluaciones.</p>
              </div>
            )}
          </>
        )}
      </section>
      {modal && (
        <div
          className="team-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setModal(false);
          }}
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-dialog-title"
            className="team-dialog"
            onKeyDown={dialogKeys}
          >
            <div className="team-dialog-heading">
              <h2 id="team-dialog-title">
                {inviteRole === "ANALYST" ? "Invitar analista" : "Invitar reemplazo administrativo"}
              </h2>
              <button
                type="button"
                aria-label="Cerrar"
                title="Cerrar"
                disabled={busy}
                onClick={() => setModal(false)}
              >
                <X size={22} />
              </button>
            </div>
            <form onSubmit={invite}>
              <label htmlFor="team-email">Correo electrónico</label>
              <input
                ref={emailInput}
                id="team-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "team-email-error" : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError("");
                }}
                placeholder="analista@institucion.com"
              />
              {error && (
                <p id="team-email-error" role="alert" className="institution-error">
                  {error}
                </p>
              )}
              <dl>
                <div>
                  <dt>Institución</dt>
                  <dd>{tenantName}</dd>
                </div>
                <div>
                  <dt>Se invitará como</dt>
                  <dd>{inviteRole === "ANALYST" ? "Analista" : "Administrador institucional"}</dd>
                </div>
              </dl>
              <p>
                {inviteRole === "ANALYST"
                  ? `La invitación generará un enlace para activar el acceso a ${tenantName}.`
                  : `El reemplazo deberá aceptar la invitación antes de que otro administrador pueda retirar el acceso anterior en ${tenantName}.`}
              </p>
              <div className="team-dialog-actions">
                <button type="button" disabled={busy} onClick={() => setModal(false)}>
                  Cancelar
                </button>
                <button className="institution-primary" disabled={busy || !email.trim()}>
                  {busy ? "Enviando..." : "Enviar invitación"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {choice && (
        <div
          className="team-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setChoice(null);
          }}
        >
          <div
            ref={choiceDialog}
            className="team-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-action-title"
            onKeyDown={dialogKeys}
          >
            <h2 id="team-action-title">
              {
                {
                  cancel: "Cancelar invitación",
                  suspend: "Suspender acceso",
                  reactivate: "Reactivar acceso",
                  revoke: "Revocar acceso",
                }[choice.action]
              }
            </h2>
            <p>
              <strong>{choice.member.name ?? choice.member.email}</strong> · {choice.member.email}
            </p>
            <p>
              Institución: <strong>{tenantName}</strong>
            </p>
            <p>
              {choice.action === "cancel"
                ? "El enlace pendiente dejará de funcionar."
                : choice.action === "suspend"
                  ? "La persona perderá acceso a esta institución hasta que la reactives."
                  : choice.action === "reactivate"
                    ? "La persona recuperará acceso a esta institución con sus credenciales actuales."
                    : "La persona perderá acceso a esta institución. Su historial y otros accesos institucionales permanecerán intactos."}
            </p>
            <div className="team-dialog-actions">
              <button disabled={busy} onClick={() => setChoice(null)}>
                Volver
              </button>
              <button className="institution-primary" disabled={busy} onClick={change}>
                {busy ? "Guardando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
