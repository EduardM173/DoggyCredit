import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Menu, X } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Brand } from "../components/Brand";
import { PublicInfo } from "../components/PublicInfo";

export function AppLayout() {
  const location = useLocation();
  const home = location.pathname === "/";
  const dark = home || location.pathname === "/solicitar-acceso" || location.pathname === "/verificar-correo";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!location.hash) window.scrollTo(0, 0);
    else document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.pathname, location.hash]);
  return (
    <div className={`app-shell${home ? " landing-shell" : ""}`}>
      <a href="#main-content" className="skip-link">
        Ir al contenido
      </a>
      <header className={`topbar${dark ? " topbar-dark" : ""}`}>
        <div className="container header-inner">
          <Brand dark={dark} />
          {home && (
            <>
              <button
                type="button"
                className="icon-button menu-toggle"
                aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
                aria-expanded={menuOpen}
                aria-controls="public-navigation"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {menuOpen ? <X /> : <Menu />}
              </button>
              <nav
                id="public-navigation"
                className={`public-nav${menuOpen ? " is-open" : ""}`}
                aria-label="Navegación principal"
              >
                {[
                  ["Inicio", "inicio"],
                  ["Cómo funciona", "como-funciona"],
                  ["Planes", "planes"],
                  ["Seguridad", "seguridad"],
                  ["Contacto", "contacto"],
                ].map(([label, id]) => (
                  <a href={`/#${id}`} key={id} onClick={() => setMenuOpen(false)}>
                    {label}
                  </a>
                ))}
              </nav>
            </>
          )}
          <div className="header-actions">
            {!home && (
              <Link to="/" className="back-link" aria-label="Volver al inicio">
                <ArrowLeft size={18} />
                <span>Volver al inicio</span>
              </Link>
            )}
            <Link to="/iniciar-sesion" className="button button-outline login-link">
              Iniciar sesión
            </Link>
            {home && (
              <Link to="/solicitar-acceso" className="button button-primary header-request">
                Solicitar acceso <ArrowRight size={17} />
              </Link>
            )}
          </div>
        </div>
      </header>
      <Outlet />
      <footer id="contacto" className={`site-footer${home ? " home-footer" : ""}`}>
        <div className="container">
          <div className="footer-main">
            <div>
              <Brand />
              {home && (
                <p>
                  Evaluaciones crediticias para
                  <br />
                  instituciones que quieren ir más lejos.
                </p>
              )}
            </div>
            {home ? (
              <>
                <nav aria-label="Navegación del pie de página">
                  <strong>Navegación</strong>
                  <a href="/#inicio">Inicio</a>
                  <a href="/#como-funciona">Cómo funciona</a>
                  <a href="/#planes">Planes</a>
                  <a href="/#seguridad">Seguridad</a>
                </nav>
                <div className="footer-contact">
                  <strong>¿Tienes preguntas?</strong>
                  <p>Conversemos sobre tu institución.</p>
                  <PublicInfo kind="contact" className="button button-outline">
                    Contactar <ArrowRight size={16} />
                  </PublicInfo>
                </div>
              </>
            ) : (
              <div className="legal-links">
                <PublicInfo kind="terms">Términos de uso</PublicInfo>
                <PublicInfo kind="privacy">Política de privacidad</PublicInfo>
                <PublicInfo kind="contact">Contacto</PublicInfo>
              </div>
            )}
          </div>
          {home && (
            <div className="footer-bottom">
              <span>© {new Date().getFullYear()} DoggyCredit. Todos los derechos reservados.</span>
              <div className="legal-links">
                <PublicInfo kind="terms">Términos de uso</PublicInfo>
                <PublicInfo kind="privacy">Política de privacidad</PublicInfo>
              </div>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
