import { Link } from "react-router-dom";
import { ArrowRight, FileText, Info, ListChecks, Plus, ShieldCheck } from "lucide-react";

export function AnalystHome({
  slug,
  userName,
  tenantName,
  ready,
  evaluations = false,
}: {
  slug: string;
  userName: string;
  tenantName: string;
  ready: boolean;
  evaluations?: boolean;
}) {
  const firstName = userName.includes("@") ? userName : userName.split(" ")[0];
  if (evaluations)
    return (
      <main className="institution-dashboard analyst-home">
        <div className="institution-breadcrumb">
          <Link to={`/${slug}`}>Inicio</Link>
          <ArrowRight size={16} /> Evaluaciones
        </div>
        <p className="institution-eyebrow">EVALUACIONES</p>
        <h1>Evaluaciones de {tenantName}</h1>
        <section className="institution-home-panel analyst-empty">
          <FileText size={34} />
          <div>
            <h2>Nueva evaluación</h2>
            <p>El formulario de evaluación estará disponible en la siguiente etapa del proyecto.</p>
          </div>
        </section>
      </main>
    );
  return (
    <main className="institution-dashboard analyst-home">
      <p className="institution-eyebrow">INICIO</p>
      <h1>Bienvenido, {firstName}</h1>
      <p className="institution-lead">Ya puedes acceder al espacio de {tenantName}.</p>
      <div className="analyst-grid">
        <section className="institution-home-panel analyst-empty">
          <FileText size={36} />
          <div>
            <h2>Realiza tu primera evaluación</h2>
            <p>
              Identifica al solicitante y registra su necesidad crediticia cuando esté disponible el módulo de
              evaluaciones.
            </p>
            {ready ? (
              <Link className="institution-primary" to={`/${slug}/evaluaciones`}>
                <Plus size={20} /> Nueva evaluación
              </Link>
            ) : (
              <p className="institution-muted">
                <Info size={18} /> La institución debe completar su preparación antes de evaluar.
              </p>
            )}
          </div>
        </section>
        <section className="institution-home-panel analyst-steps">
          <ShieldCheck size={32} />
          <div>
            <h2>Cómo funciona una evaluación</h2>
            <ol>
              <li>Identifica al solicitante.</li>
              <li>Consulta la información financiera habilitada.</li>
              <li>Revisa los productos compatibles y las razones de la recomendación.</li>
            </ol>
          </div>
        </section>
      </div>
      <p className="analyst-note">
        <ListChecks size={19} /> Tus evaluaciones aparecerán aquí cuando el módulo esté habilitado.
      </p>
    </main>
  );
}
