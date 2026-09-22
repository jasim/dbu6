// The frontend host: Vite, run from inside the package against a project's
// folder. This is Node code; the `dbu6` command is its caller.
//
//   projectFrontend(root)         which app to serve, and whether it is stale
//   buildProjectFrontend(root)    build <root>/dist/app when the project needs one
//   createProjectDevServer(root)  the Vite dev server for `dbu6 dev`
//
// `buildHost` and `startHostDevServer` are the same two operations with every
// option open, for this repository's own build and for `dbu6 dev` in a
// project linked to it.
import {
  build,
  createServer,
  type InlineConfig,
  type ViteDevServer,
} from "vite";
import { createHostViteConfig, type HostConfigOptions } from "./config.js";

export {
  createHostViteConfig,
  PROJECT_FRONTEND_GLOBS,
  SINGLE_COPY,
  type HostConfigOptions,
  type OwnFrontend,
} from "./config.js";
export {
  buildProjectFrontend,
  projectFrontend,
  type ProjectFrontend,
} from "./project-frontend.js";

/**
 * The dev server for a project: its reports and frontend.tsx hot-update, and
 * `/api` is proxied to the API on `apiPort`. It is listening when this
 * resolves; close it with `server.close()`.
 */
export async function createProjectDevServer(
  root: string,
  options: { port?: number; apiPort?: number } = {},
): Promise<ViteDevServer> {
  return startHostDevServer({ projectRoot: root, ...options });
}

export async function startHostDevServer(
  options: HostConfigOptions,
): Promise<ViteDevServer> {
  const server = await createServer(createHostViteConfig(options));
  await server.listen();
  server.printUrls();
  return server;
}

export async function buildHost(options: HostConfigOptions): Promise<void> {
  await build(createHostViteConfig(options) satisfies InlineConfig);
}
