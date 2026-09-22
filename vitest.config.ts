import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// One test run, two projects, matching the two tsconfigs: the Node side and
// the browser side. `pnpm test` runs both; `pnpm test --project frontend`
// runs one.

const nodeModule = (name: string) =>
  path.resolve(import.meta.dirname, "node_modules", name);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          include: [
            "src/server/**/*.test.ts",
            "src/shared/**/*.test.ts",
            "src/frontend-host/**/*.test.ts",
            "src/cli/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [react()],
        resolve: {
          // Sapporta is linked from another checkout while it has unpublished
          // changes, so its dependencies would load from its own node_modules
          // as second copies. These aliases, with `inline` below, keep every
          // package that holds module state on this project's single copy.
          // The frontend host's `SINGLE_COPY` is the same list for the app.
          alias: {
            react: nodeModule("react"),
            "react-dom": nodeModule("react-dom"),
            "react-router-dom": nodeModule("react-router-dom"),
            zustand: nodeModule("zustand"),
            // Base UI keeps popup context in module state; a popover inside a
            // Sapporta dialog must see the same copy.
            "@base-ui/react": nodeModule("@base-ui/react"),
            // Sapporta's record form reads the QueryClient this app provides.
            "@tanstack/react-query": nodeModule("@tanstack/react-query"),
            // These two ship CommonJS, whose require("react") bypasses the
            // aliases above under vitest; one copy here keeps them on this
            // project's React.
            "lucide-react": nodeModule("lucide-react"),
            "use-sync-external-store": nodeModule("use-sync-external-store"),
          },
        },
        test: {
          name: "frontend",
          include: ["src/frontend/**/*.test.{ts,tsx}"],
          server: { deps: { inline: [/\/sapporta\//] } },
        },
      },
    ],
  },
});
