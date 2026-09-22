/**
 * The command's only contact with the frontend host (`src/frontend-host`),
 * which decides which web app a project is served and builds it. The host is
 * imported on demand because it brings Vite with it, and most commands never
 * need it.
 */
import { globSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageDir } from "../server/paths.js";
import { runsFromSource } from "./project.js";

const frontendHost = () => import("../frontend-host/index.js");

/**
 * The directory to serve as the web app: the project's own build when it has
 * reports or a `frontend.tsx`, otherwise the one prebuilt in the package.
 */
export async function appDir(root: string): Promise<string> {
  const { projectFrontend } = await frontendHost();
  return projectFrontend(root).appDir;
}

/**
 * Builds the project's web app. `dbu6 build` always builds; `start` passes
 * `onlyIfStale`, so it builds when the reports, `frontend.tsx` or dbu6 itself
 * changed since the last build. Returns false for a project with nothing to
 * build.
 */
export async function buildFrontend(
  root: string,
  { onlyIfStale = false } = {},
): Promise<boolean> {
  const { buildProjectFrontend } = await frontendHost();
  const result = await buildProjectFrontend(root, { force: !onlyIfStale });
  if (result.built) {
    console.log(`Built the project's web app into ${result.appDir}.`);
  }
  return result.needsBuild;
}

/**
 * What `dbu6 check` wants to know: whether the project's web app builds. The
 * build goes into a temporary directory that is removed afterwards, so the
 * check leaves the project as it found it, `dist/app` included. Resolves to
 * `null` when there is nothing to build, otherwise to the entry files that
 * were built; throws with Vite's error when the build fails.
 */
export async function tryBuildingFrontend(
  root: string,
): Promise<string[] | null> {
  const host = await frontendHost();
  if (!host.projectFrontend(root).needsBuild) return null;
  const entries = Object.values(host.PROJECT_FRONTEND_GLOBS)
    .flatMap((pattern) => globSync(pattern, { cwd: root }))
    .sort();
  const { build } = await import("vite");
  const config = host.createHostViteConfig({ projectRoot: root });
  const outDir = mkdtempSync(join(tmpdir(), "dbu6-check-build-"));
  try {
    await build({
      ...config,
      logLevel: "silent",
      build: { ...config.build, outDir, emptyOutDir: true },
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  return entries;
}

/**
 * Starts Vite for `dev` when there is a frontend to hot-update: the project's
 * reports or `frontend.tsx`, or, in dbu6's repository, our own. Returns
 * whether it did; when it did not, the server serves the prebuilt app.
 */
export async function startFrontendDevServer(root: string): Promise<boolean> {
  const host = await frontendHost();
  const ports = {
    port: integerEnv("SAPPORTA_FRONTEND_PORT", 5173),
    apiPort: integerEnv("SAPPORTA_API_PORT", 3000),
  };
  if (runsFromSource()) {
    await host.startHostDevServer({
      ...ports,
      // Vite's root is the repository even when DBU6_ROOT names a scratch
      // folder: Vite resolves react and the rest from its root's
      // node_modules, and a scratch folder has none.
      projectRoot: packageDir(),
      // `dbu6/frontend` is src/frontend, so our own code hot-updates.
      ownFrontend: "src",
    });
    return true;
  }
  if (!host.projectFrontend(root).needsBuild) return false;
  await host.createProjectDevServer(root, ports);
  return true;
}

function integerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  return Number(value);
}
