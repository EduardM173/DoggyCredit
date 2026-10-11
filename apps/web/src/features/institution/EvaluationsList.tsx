import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Clock,
  FileText,
  Plus,
} from "lucide-react";
import { institutionApi, type EvaluationItem } from "./api";
import "./evaluations.css";

const PURPOSE_LABELS: Record<string, string> = {
  WORKING_CAPITAL: "Capital de trabajo",
  BUSINESS_INVESTMENT: "Inversión",
  GREEN_PROJECT: "Proyecto verde",
  EQUIPMENT: "Equipamiento",
  OTHER: "Otro",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador preparado",
  IN_PROGRESS: "En proceso",
  COMPLETED: "Completada",
  INCOMPLETE: "Incompleta",
  FAILED: "Fallida (técnico)",
};

export function EvaluationsList({
  slug,
  tenantName,
  ready,
}: {
  slug: string;
  tenantName: string;
  ready: boolean;
}) {
  const [evaluations, setEvaluations] = useState<EvaluationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    institutionApi<EvaluationItem[]>(`/tenants/${encodeURIComponent(slug)}/evaluations`)
      .then((data) => {
        setEvaluations(data || []);
        setError("");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Error al cargar evaluaciones.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug]);

  return (
    <main className="eval-container">
      <div className="institution-breadcrumb" style={{ marginBottom: 16 }}>
        <Link to={`/${slug}`}>Inicio</Link>
        <ArrowRight size={16} /> Evaluaciones
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <p className="eval-eyebrow">EVALUACIONES</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#0b1f4d" }}>
            Evaluaciones de {tenantName}
          </h1>
        </div>
        {ready && (
          <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
            <Plus size={18} /> Nueva evaluación
          </Link>
        )}
      </div>

      {loading ? (
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ color: "#51627d" }}>Cargando evaluaciones...</p>
        </div>
      ) : error ? (
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <p style={{ color: "#b42318" }}>{error}</p>
        </div>
      ) : evaluations.length === 0 ? (
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <FileText size={42} color="#1267e8" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>No hay evaluaciones registradas</h2>
          <p style={{ color: "#51627d", maxWidth: 440, margin: "0 auto 24px" }}>
            Comienza evaluando a un solicitante para verificar su información financiera y generar
            recomendaciones crediticias.
          </p>
          {ready ? (
            <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
              <Plus size={18} /> Iniciar primera evaluación
            </Link>
          ) : (
            <p style={{ color: "#b54708", fontSize: 14 }}>
              La institución debe completar su preparación antes de poder evaluar.
            </p>
          )}
        </div>
      ) : (
        <div className="eval-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="eval-list-table">
            <thead>
              <tr>
                <th>Solicitante</th>
                <th>Finalidad</th>
                <th>Monto solicitado</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    <strong>{ev.clientName}</strong>
                    <div style={{ fontSize: 13, color: "#51627d" }}>
                      {ev.documentType}: {ev.documentNumber}
                    </div>
                  </td>
                  <td>{PURPOSE_LABELS[ev.purpose] || ev.purpose}</td>
                  <td>Bs {ev.requestedAmount.toLocaleString()}</td>
                  <td>
                    <span className={`eval-status-badge eval-status-${ev.status}`}>
                      <Clock size={12} /> {STATUS_LABELS[ev.status] || ev.status}
                    </span>
                  </td>
                  <td style={{ color: "#51627d", fontSize: 13 }}>
                    {new Date(ev.createdAt).toLocaleDateString("es-BO")}
                  </td>
                  <td>
                    <Link
                      to={`/${slug}/evaluaciones/${ev.id}`}
                      style={{ color: "#1267e8", fontWeight: 600, fontSize: 13, textDecoration: "none" }}
                    >
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
