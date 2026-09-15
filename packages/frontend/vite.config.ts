import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { parseBoundedInteger } from "@sapporta/shared/validation";

// Dev topology: Vite serves the SPA on :5173 and transparently proxies
// /api/* to the Hono backend on SAPPORTA_API_PORT (default 3000) — frontend code uses
// relative URLs and never sees the backend port. In prod, Hono alone
// serves both the built SPA (packages/frontend/dist/) and the API from one origin,
// so the same relative URLs keep working. No VITE_API_URL is needed unless
// production splits the SPA and API across different origins.
//
// Multi-project on one machine: give each project its own SAPPORTA_API_PORT and
// SAPPORTA_FRONTEND_PORT in the development environment. boot.ts reads SAPPORTA_API_PORT
// to bind Hono; this config reads it as the API proxy target and reads
// SAPPORTA_FRONTEND_PORT as Vite's own port. strictPort keeps the trusted dev
// origin exact.
//
// dbu6-shared is aliased to its source so HMR works without rebuilding
// the shared package's dist/ on every edit. Backend imports the same
// package via the pnpm symlink and reads dist/ (Node can't run TS).
const apiPort = parseIntegerEnv("SAPPORTA_API_PORT", 3000);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "dbu6-shared": path.resolve(__dirname, "../shared/src/index.ts"),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(
        __dirname,
        "node_modules/react-router-dom",
      ),
      zustand: path.resolve(__dirname, "node_modules/zustand"),
      // Base UI keeps popup context in module state; a popover inside a
      // Sapporta dialog must see the same copy.
      "@base-ui/react": path.resolve(__dirname, "node_modules/@base-ui/react"),
      // Sapporta's record form reads the QueryClient this app provides.
      "@tanstack/react-query": path.resolve(
        __dirname,
        "node_modules/@tanstack/react-query",
      ),
      // These two ship CommonJS, whose require("react") bypasses the aliases
      // above under vitest; one copy here keeps them on this project's React.
      "lucide-react": path.resolve(__dirname, "node_modules/lucide-react"),
      "use-sync-external-store": path.resolve(
        __dirname,
        "node_modules/use-sync-external-store",
      ),
    },
    dedupe: [
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
      "@base-ui/react",
      "@tanstack/react-query",
      "lucide-react",
      "use-sync-external-store",
    ],
  },
  server: {
    port: parseIntegerEnv("SAPPORTA_FRONTEND_PORT", 5173),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@js-temporal/polyfill")) return "temporal";
        },
      },
    },
  },
  test: {
    server: {
      deps: {
        // Sapporta is linked from another checkout, so its dependencies
        // (React, Base UI, sonner, zustand) would load from its own
        // node_modules as second copies. Transforming them through Vite lets
        // the aliases above point them at this project's single copies.
        inline: [/\/sapporta\//],
      },
    },
  },
});

function parseIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return parseBoundedInteger(value, {
    name,
    min: 0,
    defaultValue: fallback,
    makeError: () => new Error(`${name} must be an integer.`),
  });
}
