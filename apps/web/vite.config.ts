import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import process from "node:process";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "sensitive-page-cache-policy",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (
            /^\/(admin(?:\/|$)|iniciar-sesion|elegir-institucion|verificar-correo|solicitud-recibida|contratacion|doggypay-demo|[a-z0-9]+(?:-[a-z0-9]+)*(?:\?|$))/.test(
              req.url ?? "",
            )
          )
            res.setHeader("Cache-Control", "no-store");
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (
            /^\/(admin(?:\/|$)|iniciar-sesion|elegir-institucion|verificar-correo|solicitud-recibida|contratacion|doggypay-demo|[a-z0-9]+(?:-[a-z0-9]+)*(?:\?|$))/.test(
              req.url ?? "",
            )
          )
            res.setHeader("Cache-Control", "no-store");
          next();
        });
      },
    },
  ],
  server: {
    host: loadEnv(mode, process.cwd(), "").DEV_HOST || "localhost",
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if (response && "writeHead" in response && !response.headersSent && !response.writableEnded)
              response.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "1" }).end();
          });
        },
      },
    },
    port: 5173,
    headers: { "Referrer-Policy": "no-referrer" },
  },
  preview: { headers: { "Referrer-Policy": "no-referrer" } },
  test: {
    environment: "jsdom",
  },
}));
