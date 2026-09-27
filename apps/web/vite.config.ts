import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "sensitive-page-cache-policy",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (/^\/(admin(?:\/|$)|verificar-correo|solicitud-recibida)/.test(req.url ?? ""))
            res.setHeader("Cache-Control", "no-store");
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (/^\/(admin(?:\/|$)|verificar-correo|solicitud-recibida)/.test(req.url ?? ""))
            res.setHeader("Cache-Control", "no-store");
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    headers: { "Referrer-Policy": "no-referrer" },
  },
  preview: { headers: { "Referrer-Policy": "no-referrer" } },
  test: {
    environment: "jsdom",
  },
});
