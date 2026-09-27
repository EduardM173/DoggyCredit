import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ChevronRight,
  Database,
  FileText,
  Leaf,
  LockKeyhole,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";

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
const planCards = [
  {
    value: "INITIAL",
    name: "Inicial",
    icon: Leaf,
    color: "mint",
    description: "Ideal para instituciones que están comenzando a digitalizar sus evaluaciones crediticias.",
    features: ["Evaluaciones básicas", "Integración de datos", "Soporte por correo"],
  },
  {
    value: "PROFESSIONAL",
    name: "Profesional",
    icon: BarChart3,
    color: "blue",
    description: "Más capacidades para instituciones en crecimiento.",
    features: [
      "Evaluaciones avanzadas",
      "Más fuentes de datos",
      "Reportes y análisis",
      "Soporte prioritario",
    ],
  },
  {
    value: "INSTITUTIONAL",
    name: "Institucional",
    icon: Building2,
    color: "violet",
    description: "Solución a la medida para instituciones con requerimientos específicos.",
    features: [
      "Configuración personalizada",
      "Integraciones avanzadas",
      "Acompañamiento especializado",
      "Soporte dedicado",
    ],
  },
];

export function HomePage() {
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
            <img src="/images/landing-reference.png" alt="" fetchPriority="high" />
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
            <p>
              Ofrecemos diferentes planes que se adaptan a tus necesidades.
              <br />
              Conversemos para encontrar la mejor opción para tu institución.
            </p>
          </div>
          <div className="plans-grid">
            {planCards.map(({ value, name, icon: Icon, color, description, features }) => (
              <article className={`plan-item ${color}`} key={value}>
                <div className="plan-heading">
                  <span className="feature-icon">
                    <Icon size={29} />
                  </span>
                  <div>
                    <h3>Plan {name}</h3>
                    <p>{description}</p>
                  </div>
                </div>
                <ul>
                  {features.map((feature) => (
                    <li key={feature}>
                      <Check size={16} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/solicitar-acceso?plan=${value}`}
                  className="plan-link"
                  aria-label={`Solicitar acceso con plan ${name}`}
                >
                  Me interesa <ArrowRight size={17} />
                </Link>
              </article>
            ))}
          </div>
          <div className="plans-action">
            <Link to="/solicitar-acceso" className="button button-navy">
              Solicitar acceso para conocer más <ArrowRight size={18} />
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
                text: "Cada institución opera en su propio espacio, con datos separados.",
              },
              {
                icon: LockKeyhole,
                title: "Protección de datos",
                text: "Buenas prácticas de seguridad en el manejo de la información.",
              },
              {
                icon: FileText,
                title: "Confianza y transparencia",
                text: "Información clara para acompañar las decisiones de tu institución.",
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
