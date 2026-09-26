import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // In dev, proxy /api and /healthz to the Go backend on 8080.
      // Production: backend serves both the API and the built SPA directly.
      // ws: the collab hubs (/api/v1/{docs,sheets,slides,…}/d/<id>/connect)
      // are WebSockets; without this the dev editors silently run offline.
      "/api": { target: "http://127.0.0.1:8080", ws: true },
      "/healthz": "http://127.0.0.1:8080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
