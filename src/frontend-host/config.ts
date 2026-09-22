import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { InlineConfig } from "vite";
import {
  dbu6Host,
  ownFrontendFiles,
  SINGLE_COPY,
  type OwnFrontend,
} from "./plugin.js";
import { assertSingleCopies } from "./single-copy.js";

export {
  PROJECT_FRONTEND_GLOBS,
  SINGLE_COPY,
  type OwnFrontend,
} from "./plugin.js";

// dist/frontend-host/config.js -> the package directory.
export const packageDir = path.resolve(import.meta.dirname, "../..");

export interface HostConfigOptions {
  projectRoot: string;
  apiPort?: number;
  port?: number;
  /** See `OwnFrontend`. Only this repository passes it. */
  ownFrontend?: OwnFrontend;
}

export function createHostViteConfig({
  projectRoot,
  apiPort = 3000,
  port = 5173,
  ownFrontend = "installed",
}: HostConfigOptions): InlineConfig {
  assertSingleCopies(projectRoot, packageDir);
  const installed = ownFrontend === "installed";
  return {
    // Never read a vite.config from the user's project: there is none, and
    // one left by accident must not change how dbu6 builds.
    configFile: false,
    root: projectRoot,
    // A public/ folder is not part of a dbu6 project; do not serve one that
    // happens to exist.
    publicDir: false,
    cacheDir: path.join(projectRoot, "node_modules/.vite-dbu6"),
    plugins: [
      dbu6Host({ projectRoot, packageDir, ownFrontend }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      dedupe: SINGLE_COPY,
      alias: installed
        ? []
        : [
            {
              find: /^dbu6\/frontend$/,
              replacement: ownFrontendFiles(packageDir, ownFrontend).js,
            },
            // Installed, package.json's `browser` condition does this.
            {
              find: /^dbu6\/server$/,
              replacement: ownFrontendFiles(packageDir, ownFrontend).contract,
            },
          ],
    },
    optimizeDeps: {
      // The entry is virtual, so Vite's scan of the project finds only what
      // the user's files import. Name ours, or the first page load discovers
      // it late and reloads. An alias to a file of ours is not a dependency.
      include: installed ? ["dbu6/frontend"] : [],
    },
    server: {
      port,
      strictPort: true,
      proxy: { "/api": `http://localhost:${apiPort}` },
    },
    build: {
      outDir: path.join(projectRoot, "dist/app"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("@js-temporal/polyfill")) return "temporal";
          },
        },
      },
    },
  };
}
