/**
 * dbu6 as an HTTP application on a project folder. dbu6 owns the startup
 * order, so a project's code cannot get it wrong: open the runtime, install
 * middleware, mount the framework's routes and ours, then the project's
 * reports, then its `dbu6.config.ts` additions, then OpenAPI over all of it,
 * and the frontend last, because its fallback answers every remaining GET.
 *
 * It never changes a schema: with a pending migration the runtime refuses to
 * open, and the message says to migrate (`dbu6 migrate`, or `dbu6 start`).
 */
import { Hono } from "hono";
import {
  mountOpenApi,
  mountSapportaFramework,
  TsRestApi,
  type SapportaEnv,
} from "@sapporta/server";
import {
  CONFIG_FILE,
  loadProjectConfig,
  type Dbu6App,
  type ProjectConfig,
} from "./config.js";
import * as mount from "./mount.js";
import { reportsDir } from "./paths.js";
import { mountProjectReports } from "./project-reports.js";
import { addRoutesWithoutCollision } from "./route-collisions.js";
import { openDbu6Runtime, type Dbu6Runtime } from "./runtime.js";

export interface OpenDbu6Options {
  /** The project folder. */
  root: string;
  /**
   * The built web app to serve: the package's prebuilt one, or the project's
   * own build when it has reports or a `frontend.tsx`. Left out, no frontend
   * is served (an API-only host, or a test).
   */
  appDir?: string;
}

/**
 * Builds the whole application, without listening. `serveDbu6` (mount.ts)
 * listens on it.
 */
export async function openDbu6(options: OpenDbu6Options): Promise<Dbu6App> {
  const { root } = options;
  // The config is read before the runtime opens because a seam in it is an
  // input to the runtime; its `extend` runs later, once there is an app.
  const project = await loadProjectConfig(root);
  const runtime = await openDbu6Runtime({
    root,
    loadCategorizer: project.config.loadCategorizer,
  });
  try {
    return await mountDbu6(runtime, project, options.appDir);
  } catch (error) {
    // A project file that fails to load must not leave the database open.
    runtime.close();
    throw error;
  }
}

async function mountDbu6(
  runtime: Dbu6Runtime,
  { file: configFile, config }: ProjectConfig,
  appDir: string | undefined,
): Promise<Dbu6App> {
  const { conn, sapporta, projectAuth } = runtime;

  const hono = new Hono<SapportaEnv>();
  mount.installDbu6Middleware(hono, runtime);
  // Built-in APIs (table metadata, CRUD rows, SQL tools), then ours under /api.
  const frameworkApi = mountSapportaFramework(hono, sapporta, {
    conn,
    auth: { requireAuthContext: projectAuth.requireAuthContext },
  });
  hono.route("/api", projectAuth.routes);
  const api = new TsRestApi<SapportaEnv>();
  mount.loadDbu6App(api, runtime);

  await mountProjectReports(api, hono, reportsDir(runtime.root));
  const app: Dbu6App = { hono, api, runtime };
  if (config.extend) {
    const source = configFile ?? CONFIG_FILE;
    // `extend` may add to either; a route is checked where it was added.
    await addRoutesWithoutCollision({
      target: hono,
      prefix: "/",
      existing: prefixed("/api", api),
      source,
      add: () =>
        addRoutesWithoutCollision({
          target: api,
          prefix: "/api",
          existing: hono,
          source,
          add: () => config.extend?.(app),
        }),
    });
  }

  // Hono copies a sub-app's routes when it is mounted, so `api` goes on only
  // now that everything has been added to it.
  hono.route("/api", api);
  // /api is private, so discovery needs the credentials that data commands need.
  mountOpenApi(hono, sapporta, frameworkApi, api, projectAuth.routes);
  if (appDir !== undefined) mount.mountDbu6Frontend(hono, appDir);
  return app;
}

function prefixed(
  prefix: string,
  api: TsRestApi<SapportaEnv>,
): { routes: Hono<SapportaEnv>["routes"] } {
  return {
    get routes() {
      return api.routes.map((route) => ({
        ...route,
        path: `${prefix}${route.path}`,
      }));
    },
  };
}
