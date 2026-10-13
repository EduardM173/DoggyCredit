import { createServer } from "node:http";
import { connect } from "node:net";
import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const runtime = join(directory, ".runtime");
const host = "127.0.0.1";
const port = 4400;
const origin = `http://${host}:${port}`;
const token = randomBytes(32).toString("hex");
const processes = new Map();
const intentionallyStopped = new Set();
const restarts = new Map();
const messages = new Map();
const definitions = {
  api: { command: "npm run dev:api", url: "http://localhost:3000/api/health", port: 3000 },
  web: { command: "npm run dev:web", url: "http://localhost:5173/", port: 5173 },
};
let postgresService = process.env.DOGGYCREDIT_POSTGRES_SERVICE || "";
let busy = false;

mkdirSync(runtime, { recursive: true });

async function discoverPostgres() {
  if (postgresService) return;
  try {
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Name)",
    ]);
    postgresService = stdout.trim();
  } catch {
    postgresService = "";
  }
}

function tcpCheck(checkPort) {
  return new Promise((finish) => {
    const socket = connect({ host: "localhost", port: checkPort });
    const timeout = setTimeout(() => socket.destroy(), 1800);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      finish(false);
    });
    socket.once("close", () => {
      clearTimeout(timeout);
      finish(false);
    });
  });
}

async function httpCheck(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!response.ok) return { online: false, latencyMs: null };
    if (url.endsWith("/api/health")) {
      const body = await response.json();
      if (body.status !== "ok") return { online: false, latencyMs: null };
    }
    return { online: true, latencyMs: Date.now() - started };
  } catch {
    return { online: false, latencyMs: null };
  }
}

async function health() {
  const [database, api, web] = await Promise.all([
    tcpCheck(5432),
    httpCheck(definitions.api.url),
    httpCheck(definitions.web.url),
  ]);
  const state = {
    checkedAt: new Date().toISOString(),
    busy,
    database: {
      online: database,
      managed: Boolean(postgresService),
      service: postgresService || null,
      url: "localhost:5432",
      message: messages.get("database") || null,
    },
    api: {
      ...api,
      managed: Boolean(processes.get("api")),
      starting: Boolean(processes.get("api")) && !api.online,
      url: definitions.api.url,
      message: messages.get("api") || null,
    },
    web: {
      ...web,
      managed: Boolean(processes.get("web")),
      starting: Boolean(processes.get("web")) && !web.online,
      url: definitions.web.url,
      message: messages.get("web") || null,
    },
  };
  return state;
}

function startApp(name, automatic = false) {
  const definition = definitions[name];
  if (processes.has(name)) return;
  intentionallyStopped.delete(name);
  messages.delete(name);
  const file = openSync(join(runtime, `${name}.log`), "a");
  const child = spawn("cmd.exe", ["/d", "/s", "/c", definition.command], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", file, file],
  });
  closeSync(file);
  processes.set(name, child);
  child.once("error", (error) => {
    messages.set(name, `No se pudo iniciar: ${error.message}`);
    processes.delete(name);
  });
  child.once("exit", (code) => {
    if (processes.get(name) !== child) return;
    processes.delete(name);
    if (intentionallyStopped.has(name)) return;
    messages.set(name, `El proceso terminó (código ${code ?? "desconocido"}).`);
    const now = Date.now();
    const attempts = (restarts.get(name) || []).filter((time) => now - time < 300000);
    if (attempts.length >= 3) {
      messages.set(name, "El servicio falló repetidamente. Revisa su registro e inícialo manualmente.");
      return;
    }
    attempts.push(now);
    restarts.set(name, attempts);
    setTimeout(() => {
      if (!intentionallyStopped.has(name) && !processes.has(name)) startApp(name, true);
    }, 3000).unref();
  });
  messages.set(name, automatic ? "Reiniciando tras una caída..." : "Iniciando...");
}

async function stopApp(name) {
  const child = processes.get(name);
  if (!child)
    throw new Error("Este servicio se inició fuera del panel. Ciérralo desde la terminal donde fue abierto.");
  intentionallyStopped.add(name);
  try {
    await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { timeout: 10000 });
  } catch (error) {
    if (error.code !== 128) {
      intentionallyStopped.delete(name);
      throw new Error("No se pudo detener el proceso. Revisa el Administrador de tareas.", { cause: error });
    }
  }
  processes.delete(name);
  messages.set(name, "Detenido desde el panel.");
}

async function databaseAction(action) {
  if (!postgresService) throw new Error("No se encontró un servicio PostgreSQL de Windows.");
  try {
    await run("sc.exe", [action === "start" ? "start" : "stop", postgresService], { timeout: 12000 });
    messages.set("database", action === "start" ? "Iniciando PostgreSQL..." : "Deteniendo PostgreSQL...");
  } catch (error) {
    const details = `${error.stdout || ""} ${error.stderr || ""}`;
    if (/acceso denegado|access is denied|FAILED 5|error 5/i.test(details)) {
      throw new Error(
        "Windows requiere permisos de administrador para controlar PostgreSQL. Abre el panel como administrador.",
        { cause: error },
      );
    }
    throw new Error(
      `Windows no pudo ${action === "start" ? "iniciar" : "detener"} PostgreSQL. Revisa el estado del servicio.`,
      { cause: error },
    );
  }
}

async function act(target, action) {
  if (busy) throw new Error("Hay otra operación en curso.");
  if (!/^(database|api|web|all)$/.test(target) || !/^(start|stop|restart)$/.test(action)) {
    throw new Error("Acción no válida.");
  }
  if (target === "database" && action === "restart")
    throw new Error("Reinicia PostgreSQL desde Servicios de Windows.");
  busy = true;
  try {
    const current = await health();
    if (target === "all") {
      if (action === "restart") throw new Error("Reinicia los servicios por separado.");
      if (action === "start") {
        if (!current.database.online) {
          await databaseAction("start");
          let ready = false;
          for (let count = 0; count < 12; count += 1) {
            await new Promise((finish) => setTimeout(finish, 1000));
            if (await tcpCheck(5432)) {
              ready = true;
              break;
            }
          }
          if (!ready)
            throw new Error("PostgreSQL aún no responde. Comprueba el servicio antes de iniciar la API.");
        }
        if (!current.api.online) startApp("api");
        if (!current.web.online) startApp("web");
      } else {
        const external = ["web", "api"].filter((name) => current[name].online && !processes.has(name));
        if (external.length) {
          throw new Error(
            `Estos servicios se iniciaron fuera del panel: ${external.join(", ")}. Ciérralos en su terminal antes de detener todo.`,
          );
        }
        if (current.database.online) await databaseAction("stop");
        for (const name of ["web", "api"]) {
          if (processes.has(name)) await stopApp(name);
        }
      }
    } else if (target === "database") {
      if (action === "start" && !current.database.online) await databaseAction("start");
      if (action === "stop" && current.database.online) await databaseAction("stop");
    } else {
      if (action === "start") {
        if (current[target].online)
          throw new Error("El puerto ya está ocupado. El servicio está funcionando fuera del panel.");
        startApp(target);
      } else if (action === "stop") {
        await stopApp(target);
      } else {
        await stopApp(target);
        startApp(target);
      }
    }
    return { ok: true, state: await health() };
  } finally {
    busy = false;
  }
}

function logTail(name) {
  const path = join(runtime, `${name}.log`);
  try {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, 32768);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      return buffer.toString("utf8").split(/\r?\n/).slice(-90).join("\n");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "Aún no hay registros de este servicio.";
  }
}

function respond(response, code, body, type = "application/json; charset=utf-8") {
  response.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  });
  response.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", origin);
  if (request.headers.host !== `${host}:${port}`)
    return respond(response, 403, { error: "Host no permitido." });
  if (request.method === "GET" && url.pathname === "/") {
    return respond(
      response,
      200,
      readFileSync(join(directory, "index.html"), "utf8"),
      "text/html; charset=utf-8",
    );
  }
  if (request.method === "GET" && url.pathname === "/style.css") {
    return respond(
      response,
      200,
      readFileSync(join(directory, "style.css"), "utf8"),
      "text/css; charset=utf-8",
    );
  }
  if (request.method === "GET" && url.pathname === "/app.js") {
    return respond(
      response,
      200,
      readFileSync(join(directory, "app.js"), "utf8"),
      "text/javascript; charset=utf-8",
    );
  }
  if (request.method === "GET" && url.pathname === "/api/session") return respond(response, 200, { token });
  if (request.method === "GET" && url.pathname === "/api/status")
    return respond(response, 200, await health());
  if (request.method === "GET" && /^\/api\/logs\/(api|web)$/.test(url.pathname)) {
    return respond(response, 200, { text: logTail(url.pathname.split("/").at(-1)) });
  }
  if (request.method === "POST" && url.pathname === "/api/action") {
    if (
      request.headers.origin !== origin ||
      request.headers["x-control-token"] !== token ||
      !String(request.headers["content-type"] || "").startsWith("application/json")
    ) {
      return respond(response, 403, { error: "Solicitud no autorizada." });
    }
    try {
      let input = "";
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 1024) throw new Error("Solicitud demasiado grande.");
      }
      const { target, action } = JSON.parse(input);
      return respond(response, 200, await act(target, action));
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  }
  return respond(response, 404, { error: "No encontrado." });
});

server.listen(port, host, async () => {
  await discoverPostgres();
  console.log(`Panel DoggyCredit disponible en ${origin}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
