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
            /^\/(admin(?:\/|$)|verificar-correo|solicitud-recibida|contratacion|doggypay-demo)/.test(
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
            /^\/(admin(?:\/|$)|verificar-correo|solicitud-recibida|contratacion|doggypay-demo)/.test(
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
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
    port: 5173,
    headers: { "Referrer-Policy": "no-referrer" },
  },
  preview: { headers: { "Referrer-Policy": "no-referrer" } },
  test: {
    environment: "jsdom",
  },
}));
