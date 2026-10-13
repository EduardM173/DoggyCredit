const services = ["database", "api", "web"];
const labels = { database: "PostgreSQL", api: "API", web: "Aplicación web" };
let token;
let pending = false;
let previous = null;

const notice = document.getElementById("notice");
const dialog = document.getElementById("log-dialog");

function inform(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
}

function update(data) {
  const count = services.filter((name) => data[name].online).length;
  const healthy = count === 3;
  document.getElementById("summary-title").textContent = healthy
    ? "Todo listo para la demostración"
    : count === 0
      ? "Sistema detenido"
      : "Requiere atención";
  document.getElementById("summary-count").textContent = `${count} de 3 activos`;
  document.getElementById("last-check").textContent =
    `Última comprobación: ${new Date(data.checkedAt).toLocaleTimeString("es-BO")}`;
  document.getElementById("summary-dot").className = `summary-dot ${healthy ? "good" : "bad"}`;
  document.getElementById("start-all").disabled = pending || healthy;
  document.getElementById("stop-all").disabled = pending || count === 0;

  for (const name of services) {
    const service = data[name];
    const row = document.querySelector(`[data-service="${name}"]`);
    const badge = row.querySelector("[data-state]");
    const detail = row.querySelector("[data-detail]");
    const state = service.online ? "up" : service.starting ? "starting" : "down";
    badge.className = `badge ${state}`;
    badge.textContent = service.online ? "Activo" : service.starting ? "Iniciando" : "Detenido";
    detail.textContent =
      service.message && !service.online
        ? service.message
        : service.online
          ? name === "database"
            ? "Conexión disponible"
            : service.managed
              ? `Respuesta correcta · ${service.latencyMs} ms`
              : "Activo desde otra terminal"
          : name === "database" && !service.managed
            ? "No se encontró el servicio de Windows"
            : "No responde";
    row.querySelector('[data-action="start"]').disabled =
      pending || service.online || service.starting || (name === "database" && !service.managed);
    row.querySelector('[data-action="stop"]').disabled =
      pending || !service.online || (name !== "database" && !service.managed);
  }

  const fallenNames = previous ? services.filter((name) => previous[name] && !data[name].online) : [];
  if (fallenNames.length) {
    const fallen = fallenNames.map((name) => labels[name]).join(", ");
    inform(`Se perdió la conexión con ${fallen}. Revisa el registro o inicia el servicio.`, true);
    if (Notification.permission === "granted")
      new Notification("DoggyCredit: servicio caído", { body: fallen });
  }
  previous = Object.fromEntries(services.map((name) => [name, data[name].online]));
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("El panel no responde correctamente.");
    update(await response.json());
  } catch {
    inform("No se puede comprobar el estado. Recarga el panel.", true);
  }
}

async function action(target, operation) {
  if (pending) return;
  if (target === "all" && operation === "stop" && !confirm("¿Detener la web, la API y PostgreSQL?")) return;
  pending = true;
  notice.hidden = true;
  await refresh();
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Control-Token": token },
      body: JSON.stringify({ target, action: operation }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
    update(result.state);
    inform(
      `${target === "all" ? "Los servicios" : labels[target]}: orden de ${operation === "start" ? "inicio" : "detención"} enviada.`,
    );
  } catch (error) {
    inform(error.message, true);
  } finally {
    pending = false;
    await refresh();
  }
}

async function showLogs(name) {
  const response = await fetch(`/api/logs/${name}`);
  const result = await response.json();
  document.getElementById("log-title").textContent = `Registro de ${labels[name]}`;
  document.getElementById("log-content").textContent = result.text;
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const command = event.target.closest("[data-action]");
  if (!command) return;
  const name = command.closest("[data-service]").dataset.service;
  if (command.dataset.action === "logs") showLogs(name);
  else action(name, command.dataset.action);
});
document.getElementById("start-all").addEventListener("click", () => action("all", "start"));
document.getElementById("stop-all").addEventListener("click", () => action("all", "stop"));
document.getElementById("close-log").addEventListener("click", () => dialog.close());
if ("Notification" in window && Notification.permission === "default") {
  const button = document.getElementById("notifications");
  button.hidden = false;
  button.addEventListener("click", async () => {
    const permission = await Notification.requestPermission();
    button.hidden = true;
    inform(
      permission === "granted"
        ? "Alertas del navegador activadas."
        : "Las alertas del navegador no se activaron.",
    );
  });
}

fetch("/api/session")
  .then((response) => response.json())
  .then((session) => {
    token = session.token;
    refresh();
  });
setInterval(refresh, 4000);
