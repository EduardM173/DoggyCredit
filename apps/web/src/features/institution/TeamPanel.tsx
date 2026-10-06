import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock3, Mail, Plus, Send, Users, X } from "lucide-react";
import "./team.css";

type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: "INSTITUTION_ADMIN" | "ANALYST";
  status: "ACTIVE" | "INVITED";
  isInitialAdmin: boolean;
  invitation: {
    id: string;
    sentAt: string | null;
    expiresAt: string;
    lastSendErrorCode: string | null;
  } | null;
};
type Team = { tenant: { name: string; slug: string }; members: TeamMember[] };
type TeamMutation = { emailSent: boolean; team: Team };

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
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    teamApi<Team>(slug)
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
  }, [slug, reload]);

  useEffect(() => {
    if (!modal) return;
    emailInput.current?.focus();
    const trigger = inviteButton.current;
    return () => trigger?.focus();
  }, [modal]);

  function dialogKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      setModal(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []),
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
      const response = await teamApi<TeamMutation>(slug, "/invitations", { email });
      setTeam(response.team);
      setNotice(
        response.emailSent
          ? `Invitación enviada a ${email.trim().toLowerCase()}. El analista debe abrir el enlace para activar su acceso.`
          : `La invitación quedó pendiente, pero el correo aún no salió. Puedes reenviarlo desde Equipo.`,
      );
      setModal(false);
      setEmail("");
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
      setNotice(
        response.emailSent
          ? "Invitación reenviada. El enlace anterior ya no es válido."
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
                ? `${team.members.filter((member) => member.status === "ACTIVE").length} personas con acceso`
                : "Cargando equipo..."}
            </p>
          </div>
          <button
            ref={inviteButton}
            className="institution-primary"
            onClick={() => {
              setError("");
              setModal(true);
            }}
          >
            <Plus size={20} /> Invitar analista
          </button>
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
                    <span className={`team-status ${member.status === "ACTIVE" ? "active" : "pending"}`}>
                      {member.status === "ACTIVE" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
                      {member.status === "ACTIVE"
                        ? "Activo"
                        : member.invitation?.sentAt
                          ? "Invitación pendiente"
                          : "Envío pendiente"}
                    </span>
                  </span>
                  <span role="cell">
                    {member.status === "INVITED" && member.invitation && member.role === "ANALYST" ? (
                      <button
                        className="team-resend"
                        disabled={resending !== null}
                        onClick={() => resend(member.invitation!.id)}
                      >
                        <Send size={17} />
                        {resending === member.invitation.id ? "Reenviando..." : "Reenviar invitación"}
                      </button>
                    ) : (
                      <span className="team-dash">—</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {!team.members.some((member) => member.role === "ANALYST") && (
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
              <h2 id="team-dialog-title">Invitar analista</h2>
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
                  <dd>Analista</dd>
                </div>
              </dl>
              <p>El analista recibirá un enlace para activar su acceso a {tenantName}.</p>
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
    </main>
  );
}
