import { Link } from "react-router-dom";
import { LockKeyhole } from "lucide-react";

export function LoginPendingPage() {
  return (
    <main id="main-content" className="home pending-page">
      <LockKeyhole size={36} />
      <h1>Iniciar sesión</h1>
      <p>El acceso a cuentas institucionales estará disponible próximamente.</p>
      <Link to="/admin/login" className="button button-primary">
        Administración interna
      </Link>
      <Link to="/" className="button button-outline">
        Volver al inicio
      </Link>
    </main>
  );
}
