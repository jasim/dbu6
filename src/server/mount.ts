/**
 * The HTTP side of dbu6, as steps a host runs on an open runtime
 * (`runtime.ts`): the middleware every request passes, our `/api` routes, the
 * built frontend, and listening. `open.ts` calls them in order, with
 * Sapporta's framework routes, the project's additions and OpenAPI in between. They are internal, not a
 * promised interface.
 */
import { dirname, relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import {
  installExactOriginCors,
  installRequestLogging,
  installSapportaErrorHandler,
  installSapportaRequestContext,
  mountHealth,
  type SapportaEnv,
  type TsRestApi,
} from "@sapporta/server";
import agentHandoffApi from "./app/agent-handoff.js";
import classifyDraftTransactionsApi from "./app/classify-draft-transactions.js";
import codingAgentApi from "./app/coding-agent.js";
import homeApi from "./app/home.js";
import importDraftAbacusApi from "./app/import-draft-abacus.js";
import importDraftStatementsAutoApi from "./app/import-draft-statements-auto.js";
import importPresetsApi from "./app/import-presets.js";
import openingBalancesApi from "./app/opening-balances.js";
import postDraftsToJournalApi from "./app/post-drafts-to-journal.js";
import setDraftsCategoryApi from "./app/set-drafts-category.js";
import renderDraftHledgerApi from "./app/render-draft-hledger.js";
import renderJournalsHledgerApi from "./app/render-journals-hledger.js";
import reportsApi from "./app/reports.js";
import reviewApi from "./app/review.js";
import setupApi from "./app/setup.js";
import {
  llmEngineSetting,
  startCodingAgent,
} from "./modules/coding-agent/index.js";
import type { DataLock } from "./data-lock.js";
import type { Dbu6Runtime } from "./runtime.js";

/**
 * Browser sign-in lives under /api/auth/*. All other /api routes receive a
 * Sapporta auth context and are private unless the runtime was opened with
 * them as public routes.
 */
export function installDbu6Middleware(
  app: Hono<SapportaEnv>,
  runtime: Dbu6Runtime,
): void {
  const { conn, projectAuth } = runtime;
  installRequestLogging(app);
  installExactOriginCors(app, {
    origins: projectAuth.env.trustedOrigins,
    credentials: true,
  });
  installSapportaErrorHandler(app);
  if (projectAuth.env.healthPolicy === "authenticated") {
    app.use("/health", projectAuth.resolveMiddleware);
  }
  mountHealth(
    app,
    projectAuth.env.healthPolicy,
    projectAuth.requirePrincipalUser,
  );
  app.on(["GET", "POST"], "/api/auth/*", (c) =>
    projectAuth.auth.handler(c.req.raw),
  );
  installSapportaRequestContext(app, conn);
  app.use("/api/*", projectAuth.resolveMiddleware);
  app.use("/api/*", projectAuth.rejectAnonymousMiddleware);
}

/** Mounts a sub-app's handlers on `app`, and its contracts into OpenAPI. */
export function mountApi(
  app: TsRestApi<SapportaEnv>,
  api: TsRestApi<SapportaEnv>,
): void {
  app.route("/", api);
  // app.route mounts runtime handlers; extend carries sub-app contracts into OpenAPI.
  app.extend(api as unknown as { docEmitters: readonly never[] });
}

/**
 * Mounts each `app/*.ts` sub-app. `api` is already scoped to `/api`, so a
 * sub-app's "/bank" is served at /api/bank; do not repeat the `/api` prefix.
 * A new file under `app/` is not exposed until it is mounted here.
 *
 * The sub-apps that categorize are built on the runtime's categorizer seam,
 * which is all of the runtime a route needs so far.
 */
export function loadDbu6App(
  api: TsRestApi<SapportaEnv>,
  runtime: Pick<Dbu6Runtime, "loadCategorizer">,
): void {
  const { loadCategorizer } = runtime;
  mountApi(api, reportsApi);
  mountApi(api, importPresetsApi);
  mountApi(api, importDraftStatementsAutoApi(loadCategorizer));
  mountApi(api, importDraftAbacusApi(loadCategorizer));
  mountApi(api, classifyDraftTransactionsApi(loadCategorizer));
  mountApi(api, renderDraftHledgerApi);
  mountApi(api, renderJournalsHledgerApi);
  mountApi(api, postDraftsToJournalApi);
  mountApi(api, setDraftsCategoryApi);
  mountApi(api, homeApi);
  mountApi(api, reviewApi);
  mountApi(api, openingBalancesApi);
  mountApi(api, setupApi);
  mountApi(api, agentHandoffApi);
  mountApi(api, codingAgentApi);
}

/**
 * Serves the built frontend in `distDir` from the same process. Three
 * deployment shapes work:
 *   (a) same-origin via this Hono process (default; `dbu6 start`)
 *   (b) same-origin behind nginx - nginx serves the built frontend directly
 *       and proxies /api/ here; this becomes harmless dead code
 *   (c) split - SPA on a CDN, API here. Skip this call, set VITE_API_URL
 *       for the SPA build, set SAPPORTA_PUBLIC_APP_URL on the API host, and
 *       route public /api/auth/* requests to this API process.
 *
 * Call it last: API routes have already matched, and the remaining browser
 * requests fall through to index.html so client-side routes survive hard
 * reloads.
 */
export function mountDbu6Frontend(
  app: Hono<SapportaEnv>,
  distDir: string,
): void {
  // serveStatic's root is relative to process.cwd(), and the app is launched
  // from any of them - systemd, Docker, test harnesses. `|| "."` covers a cwd
  // that is already `distDir`.
  const root = relative(process.cwd(), distDir) || ".";
  // Vite assets are content-hashed, so they can be cached for a year.
  app.use("/assets/*", async (c, next) => {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    await next();
  });
  app.use("/assets/*", serveStatic({ root }));

  // HTML must revalidate because it points at the latest asset hashes.
  app.get("/index.html", async (c, next) => {
    c.header("Cache-Control", "no-cache");
    await next();
  });
  app.get("/index.html", serveStatic({ root }));

  // Root files and SPA fallbacks stay fresh across deploys.
  app.use("/*", async (c, next) => {
    c.header("Cache-Control", "no-cache");
    await next();
  });
  app.use("/*", serveStatic({ root }));
  // GET-only - a stray POST to /wat must 404, not return index.html.
  app.get("/*", serveStatic({ root, path: "index.html" }));
}

/**
 * Listens on the runtime's port, and closes SQLite cleanly when the process
 * receives a termination signal. The lock was taken before the database was
 * opened (`src/cli/main.ts`), so `migrateSafely` never swaps the file under a
 * live server; it is released here with everything else.
 */
export function serveDbu6(
  app: Hono<SapportaEnv>,
  runtime: Dbu6Runtime,
  /** The folder's lock, held while serving; released at shutdown. */
  lock: DataLock,
): void {
  // A bad LLM_ENGINE stops the server here rather than at the first import.
  llmEngineSetting();
  // Detecting the coding agents and asking which of the chosen one's models
  // answer run their CLIs, so neither holds up startup, and each runs only
  // when dbu_config has no result yet. Settings shows what was found, checks
  // the other agents only when it shows them, and detects again on request.
  startCodingAgent().catch((error: unknown) => {
    console.error("[coding-agent] startup check failed:", error);
  });

  const port = runtime.env.apiPort;
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`dbu6 API server ready (port ${port})`);
  });
  const shutdown = (signal: NodeJS.Signals) => {
    server.close();
    runtime.close();
    lock.release();
    process.kill(process.pid, signal);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
