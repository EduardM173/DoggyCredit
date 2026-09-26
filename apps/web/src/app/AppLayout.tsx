import { Outlet } from "react-router-dom";

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="DoggyCredit, inicio">
          <span className="brand-mark">DC</span>
          <span>DoggyCredit</span>
        </a>
        <span className="environment">Entorno local</span>
      </header>
      <Outlet />
    </div>
  );
}
