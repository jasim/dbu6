import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

/** The URL the host's index.html loads. Not a file: see `load` below. */
export const ENTRY_URL = "/@dbu6/entry.js";
export const HOST_CSS_URL = "/@dbu6/host.css";
const ENTRY_ID = "\0dbu6:entry.js";
const HOST_CSS_ID = "\0dbu6:host.css";

/**
 * Packages that keep state in module scope (a context, a store, a registry),
 * so the app must load exactly one copy. `resolve.dedupe` sends every import
 * of these to the copy under the project's node_modules, and
 * `assertSingleCopies` makes sure that copy is the one dbu6 itself gets.
 */
export const SINGLE_COPY = [
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "@tanstack/react-query",
  "zustand",
  "@base-ui/react",
  "lucide-react",
  "use-sync-external-store",
  "@sapporta/frontend",
  "@sapporta/grid",
  "@sapporta/ui",
  "@sapporta/shared",
];

/**
 * The project's files the entry loads, as globs relative to the project root:
 * each report's definition, and the optional pages and navigation entries.
 */
export const PROJECT_FRONTEND_GLOBS = {
  reports: "reports/*/report.{ts,tsx}",
  frontend: "frontend.{ts,tsx}",
} as const;

/**
 * Where the host finds `dbu6/frontend` and `dbu6/frontend.css`.
 *
 * - `"installed"`: through the project's node_modules, as a user's project
 *   does. The default.
 * - `"dist"` and `"src"`: from this package's own directory, for this
 *   repository, which has no node_modules/dbu6. `"dist"` is the compiled
 *   library, which `pnpm build` makes the prebuilt app from, so the app we ship
 *   went through the pipeline a user's build goes through. `"src"` is the
 *   sources, so `dbu6 dev` in a project linked to this checkout hot-updates
 *   our own code.
 */
export type OwnFrontend = "installed" | "dist" | "src";

export interface HostPluginOptions {
  /** The user's project folder. It is Vite's root. */
  projectRoot: string;
  /** node_modules/dbu6, or this repository's root. */
  packageDir: string;
  ownFrontend: OwnFrontend;
}

/** The files `dbu6/frontend` and `dbu6/frontend.css` name, when not installed. */
export function ownFrontendFiles(
  packageDir: string,
  ownFrontend: "dist" | "src",
): { js: string; css: string; contract: string } {
  // `contract` is what `dbu6/server` is in a browser: see
  // src/shared/report-contract.ts.
  return ownFrontend === "src"
    ? {
        js: path.join(packageDir, "src/frontend/index.ts"),
        css: path.join(packageDir, "src/frontend/frontend.css"),
        contract: path.join(packageDir, "src/shared/report-contract.ts"),
      }
    : {
        js: path.join(packageDir, "dist/frontend/index.js"),
        css: path.join(packageDir, "dist/frontend/frontend.css"),
        contract: path.join(packageDir, "dist/shared/report-contract.js"),
      };
}

/**
 * Serves the three things that live in the package rather than in the user's
 * project: index.html, the entry module and the Tailwind stylesheet.
 */
export function dbu6Host({
  projectRoot,
  packageDir,
  ownFrontend,
}: HostPluginOptions): Plugin {
  // Beside this module: the build copies it to dist/frontend-host/.
  const htmlTemplate = path.join(import.meta.dirname, "index.html");
  const frontendCss =
    ownFrontend === "installed"
      ? "dbu6/frontend.css"
      : ownFrontendFiles(packageDir, ownFrontend).css;
  // Build only: Vite wants an .html input under its root, and names the
  // output after it. This path never exists on disk; `load` supplies it.
  const virtualHtml = path.join(projectRoot, "index.html");

  return {
    name: "dbu6:host",
    enforce: "pre",

    config(_, { command }) {
      if (command !== "build") return;
      return { build: { rollupOptions: { input: virtualHtml } } };
    },

    resolveId(source) {
      if (source === ENTRY_URL) return ENTRY_ID;
      if (source === HOST_CSS_URL) return HOST_CSS_ID;
      if (source === virtualHtml) return virtualHtml;
      return null;
    },

    load(id) {
      if (id === ENTRY_ID) return entrySource(ownFrontend);
      if (id === HOST_CSS_ID) return hostCss(projectRoot, frontendCss);
      if (id === virtualHtml) return fs.readFileSync(htmlTemplate, "utf8");
      return null;
    },

    configureServer(server: ViteDevServer) {
      // Returned, so it runs after Vite's own middlewares: Vite finds no
      // index.html under the project root and falls through to this.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          if (!(req.headers.accept ?? "").includes("text/html")) return next();
          try {
            const template = fs.readFileSync(htmlTemplate, "utf8");
            const html = await server.transformIndexHtml(
              req.url ?? "/",
              template,
              req.originalUrl,
            );
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}

/**
 * The entry. `import.meta.glob` patterns that start with `/` are relative to
 * Vite's root, which is the user's project, so this module finds the project's
 * files without knowing where the project is, and Vite re-runs it when a
 * report folder is added or removed. `PROJECT_FRONTEND_GLOBS` names the same
 * files for the Node side.
 *
 * A failure here (a report.ts without a definition, an id dbu6 already has)
 * is put on the page as well as thrown: otherwise it is a blank screen and a
 * line in a console nobody has open.
 */
function entrySource(ownFrontend: OwnFrontend): string {
  return `
import "${HOST_CSS_URL}";
import { startDbu6Frontend } from "dbu6/frontend";

const reportModules = import.meta.glob("/${PROJECT_FRONTEND_GLOBS.reports}", {
  eager: true,
  import: "default",
});
const frontendModules = import.meta.glob("/${PROJECT_FRONTEND_GLOBS.frontend}", {
  eager: true,
  import: "default",
});

try {
  const reports = Object.entries(reportModules).map(([file, definition]) => {
    if (!definition || typeof definition !== "object") {
      throw new Error(file + " must default-export a report definition.");
    }
    return definition;
  });
  const extension = Object.values(frontendModules)[0] ?? {};
  startDbu6Frontend({
    ...extension,
    reports: [...reports, ...(extension.reports ?? [])],
  });
} catch (error) {
  const message = document.createElement("pre");
  message.style.cssText = "margin:2rem;white-space:pre-wrap;font:14px/1.5 ui-monospace,monospace";
  message.textContent = "dbu6 could not start the project's frontend.\\n\\n" +
    (error instanceof Error ? error.message : String(error));
  document.getElementById("root")?.replaceChildren(message);
  throw error;
}
${ownFrontend === "src" ? "" : "\nif (import.meta.hot) import.meta.hot.accept();"}
`;
}

/**
 * One Tailwind run for the whole app. `dbu6/frontend.css` names the code
 * beside it as a source; the project's files are added here by absolute
 * path, because a stylesheet inside node_modules cannot know where the
 * project is. `source(none)` turns off Tailwind's scan of the Vite root, so
 * data/, user-config/ and the Python parsers are never read for class names.
 */
function hostCss(projectRoot: string, frontendCss: string): string {
  const sources = [
    path.join(projectRoot, "reports"),
    path.join(projectRoot, "frontend.tsx"),
    path.join(projectRoot, "frontend.ts"),
  ];
  return [
    `@import "tailwindcss" source(none);`,
    `@import ${JSON.stringify(frontendCss)};`,
    ...sources.map((source) => `@source ${JSON.stringify(source)};`),
  ].join("\n");
}
