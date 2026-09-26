import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Client = {
  id: string;
  name: string;
  documentType: string;
  documentNumber: string;
  email: string | null;
  createdAt: string;
};

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

export function App() {
  const [tenantId, setTenantId] = useState(localStorage.getItem("tenantId") ?? "");
  const [clients, setClients] = useState<Client[]>([]);
  const [message, setMessage] = useState("Ingresa el identificador de una institución para consultar sus clientes.");
  const [loading, setLoading] = useState(false);

  async function loadClients() {
    if (!tenantId.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/clients`, { headers: { "x-tenant-id": tenantId } });
      if (!response.ok) throw new Error("No se pudo cargar la cartera de clientes.");
      const data = (await response.json()) as Client[];
      setClients(data);
      setMessage(data.length ? "Cartera actualizada." : "Esta institución todavía no registra clientes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo conectar con la API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tenantId) void loadClients();
  }, []);

  async function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("No se pudo registrar el cliente.");
      event.currentTarget.reset();
      setMessage("Cliente registrado correctamente.");
      await loadClients();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo conectar con la API.");
    } finally {
      setLoading(false);
    }
  }

  function activateTenant(event: FormEvent) {
    event.preventDefault();
    localStorage.setItem("tenantId", tenantId);
    void loadClients();
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Plataforma de evaluación crediticia</p>
          <h1>DoggyCredit</h1>
        </div>
        <span className="status">API por institución</span>
      </header>

      <section className="workspace">
        <aside>
          <h2>Institución activa</h2>
          <form onSubmit={activateTenant} className="tenant-form">
            <label htmlFor="tenantId">Identificador del tenant</label>
            <input id="tenantId" value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="UUID de la institución" required />
            <button type="submit">Cargar cartera</button>
          </form>
          <p className="notice">{message}</p>
        </aside>

        <section className="content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Clientes</p>
              <h2>Cartera de solicitantes</h2>
            </div>
            <span>{clients.length} registrados</span>
          </div>

          <form onSubmit={submitClient} className="client-form">
            <input name="name" placeholder="Nombre completo o razón social" required />
            <select name="type" defaultValue="PERSON"><option value="PERSON">Persona</option><option value="COMPANY">Empresa</option></select>
            <select name="documentType" defaultValue="CI"><option value="CI">CI</option><option value="NIT">NIT</option><option value="PASSPORT">Pasaporte</option><option value="OTHER">Otro</option></select>
            <input name="documentNumber" placeholder="Número de documento" required />
            <input name="email" type="email" placeholder="Correo electrónico" />
            <button type="submit" disabled={loading || !tenantId}>Registrar cliente</button>
          </form>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Solicitante</th><th>Documento</th><th>Correo</th><th>Registro</th></tr></thead>
              <tbody>
                {clients.map((client) => <tr key={client.id}><td>{client.name}</td><td>{client.documentType} {client.documentNumber}</td><td>{client.email ?? "Sin registro"}</td><td>{new Date(client.createdAt).toLocaleDateString("es-BO")}</td></tr>)}
                {!clients.length && <tr><td colSpan={4} className="empty">No hay registros para mostrar.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
