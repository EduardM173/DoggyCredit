import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="home">
      <p className="eyebrow">404</p>
      <h1>Página no encontrada</h1>
      <Link to="/">Volver al inicio</Link>
    </main>
  );
}
