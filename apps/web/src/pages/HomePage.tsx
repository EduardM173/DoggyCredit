import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ChevronRight,
  Database,
  FileText,
  LockKeyhole,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchPublicPlans,
  formatPlanPrice,
  type PublicPlan,
} from "../features/institution-requests/public-plans";

const process = [
  {
    icon: Database,
    title: "1. Conecta tus fuentes",
    text: "Integra tus sistemas de información de forma segura.",
  },
  {
    icon: Settings,
    title: "2. Evalúa automáticamente",
    text: "Aplicamos reglas de evaluación configuradas para tu institución.",
  },
  {
    icon: FileText,
    title: "3. Obtén recomendaciones",
    text: "Visualiza los productos crediticios más adecuados para cada perfil.",
  },
  {
    icon: BarChart3,
    title: "4. Toma mejores decisiones",
    text: "Tú decides, con información clara y confiable.",
  },
];
export function HomePage() {
  const [catalog, setCatalog] = useState<{ status: "loading" | "ready" | "error"; plans: PublicPlan[] }>({
    status: "loading",
    plans: [],
  });
  useEffect(() => {
    const controller = new AbortController();
    fetchPublicPlans(controller.signal)
      .then((plans) => setCatalog({ status: "ready", plans }))
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: "error", plans: [] });
      });
    return () => controller.abort();
  }, []);
  return (
    <main id="main-content">
      <section className="hero" id="inicio">
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Plataforma para instituciones financieras</p>
            <h1>
              Evaluaciones crediticias claras para <span>mejores decisiones</span>
            </h1>
            <p>
              DoggyCredit ayuda a tu institución a evaluar el riesgo crediticio de manera confiable y
              eficiente, integrando tus fuentes de datos y recomendando productos crediticios que se ajusten
              al perfil de cada cliente.
            </p>
            <div className="hero-actions">
              <Link to="/solicitar-acceso" className="button button-primary">
                Solicitar acceso <ArrowRight size={20} />
              </Link>
              <a href="#como-funciona" className="button button-outline">
                Conocer más <ArrowDown size={18} />
              </a>
            </div>
          </div>
          <div
            className="product-image"
            role="img"
            aria-label="Vista ilustrativa de DoggyCredit en un portátil: resumen de evaluaciones, clientes y recomendaciones"
          >
            <img src="/images/landing-reference.png" alt="" width="1024" height="1536" fetchPriority="high" />
            <span className="product-reference">Vista referencial del producto</span>
          </div>
        </div>
      </section>
      <section className="process-section section" id="como-funciona">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">Cómo funciona</p>
            <h2>Un proceso simple, resultados poderosos</h2>
            <p>
              Integra tus datos, evalúa de forma automática y obtén recomendaciones claras
              <br className="desktop-break" /> y explicables para cada cliente.
            </p>
          </div>
          <div className="process-grid">
            {process.map(({ icon: Icon, title, text }, index) => (
              <article className="process-item" key={title}>
                <span className="feature-icon">
                  <Icon size={27} />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
                {index < 3 && <ChevronRight className="process-arrow" size={22} />}
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="plans-section section" id="planes">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">Planes</p>
            <h2>Una solución para cada etapa de tu institución</h2>
            <p>Explora las opciones disponibles. El plan definitivo se confirma después de la aprobación.</p>
          </div>
          <div className="plans-grid">
            {catalog.plans.map((plan, index) => (
              <article
                className={`plan-item ${["mint", "blue", "violet"][Math.min(index, 2)]}`}
                key={plan.code}
              >
                <div className="plan-heading">
                  <span className="feature-icon">
                    <Building2 size={29} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>Plan {plan.name}</h3>
                    <p className="plan-price">{formatPlanPrice(plan)}</p>
                    {plan.shortDescription && <p>{plan.shortDescription}</p>}
                  </div>
                </div>
                <ul>
                  {plan.highlights.map((feature) => (
                    <li key={feature}>
                      <Check size={16} aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/solicitar-acceso?plan=${encodeURIComponent(plan.code)}`}
                  className="plan-link"
                  aria-label={`Me interesa el plan ${plan.name}`}
                >
                  Me interesa este plan <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
          {catalog.status === "loading" && (
            <p className="plans-state" role="status">
              Cargando planes...
            </p>
          )}
          {catalog.status === "error" && (
            <p className="plans-state" role="status">
              No pudimos mostrar los planes en este momento. Puedes solicitar acceso sin elegir uno.
            </p>
          )}
          {catalog.status === "ready" && catalog.plans.length === 0 && (
            <p className="plans-state" role="status">
              No hay planes públicos disponibles en este momento.
            </p>
          )}
          <div className="plans-action">
            <Link to="/solicitar-acceso" className="button button-navy">
              Solicitar acceso <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
      <section className="security-section section" id="seguridad">
        <div className="container">
          <div className="section-heading">
            <p className="eyebrow">Seguridad y confianza</p>
            <h2>Tu información en buenas manos</h2>
            <p>
              Diseñado con buenas prácticas de seguridad
              <br />
              para proteger la información de tu institución y de tus clientes.
            </p>
          </div>
          <div className="security-grid">
            {[
              {
                icon: ShieldCheck,
                title: "Acceso seguro",
                text: "Autenticación y control de permisos basados en roles.",
              },
              {
                icon: Database,
                title: "Aislamiento por institución",
                text: "Cada institución trabaja dentro de su propio espacio con acceso controlado.",
              },
              {
                icon: LockKeyhole,
                title: "Protección de datos",
                text: "Buenas prácticas de seguridad en el manejo de la información.",
              },
              {
                icon: FileText,
                title: "Trazabilidad",
                text: "Las operaciones relevantes se registran para facilitar su seguimiento y auditoría.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div className="security-item" key={title}>
                <span className="feature-icon">
                  <Icon size={26} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="closing-cta">
        <div className="container closing-inner">
          <div>
            <p className="eyebrow">¿Listo para empezar?</p>
            <h2>Solicita acceso a DoggyCredit</h2>
            <p>Nuestro equipo revisará tu solicitud y te contactará para continuar con el proceso.</p>
          </div>
          <div>
            <Link to="/solicitar-acceso" className="button button-primary">
              Solicitar acceso <ArrowRight size={20} />
            </Link>
            <p className="secure-note">
              <LockKeyhole size={13} /> Es un proceso rápido y seguro
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
