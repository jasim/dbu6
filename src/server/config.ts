/**
 * `<root>/dbu6.config.ts`: the one optional file through which a project
 * changes how the server is put together. It is found by name, the way Vite
 * finds `vite.config.ts`, and its default export is what `defineConfig`
 * returns.
 *
 * Everything in it is an addition. A seam replaces a decision dbu6 offers for
 * replacing; `extend` adds routes. Neither can replace a route of ours
 * (`route-collisions.ts`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Hono } from "hono";
import type { SapportaEnv, TsRestApi } from "@sapporta/server";
import type { LoadCategorizer } from "./modules/categorization/index.js";
import type { Dbu6Runtime } from "./runtime.js";

/** What `extend` is handed: the running pieces a project may add routes to. */
export interface Dbu6App {
  /** The whole HTTP app. A route added here is outside `/api`, and public. */
  hono: Hono<SapportaEnv>;
  /**
   * The `/api` sub-app: private, with an auth context on every request. A
   * contract path does not repeat the `/api` prefix. Mount a `TsRestApi` with
   * `mountApi(app.api, yours)` (from `dbu6/server`) so its routes reach
   * OpenAPI as well as the router.
   */
  api: TsRestApi<SapportaEnv>;
  runtime: Dbu6Runtime;
}

export interface Dbu6Config {
  /**
   * The categorizer seam: reclassification, the statement import and the
   * freeform import all categorize through it. Defaults to ours.
   */
  loadCategorizer?: LoadCategorizer;
  /**
   * Adds routes that are not reports. Called once, after our routes and the
   * project's reports are mounted and before OpenAPI is generated.
   */
  extend?(app: Dbu6App): void | Promise<void>;
}

/** Types the config; returns it unchanged. */
export function defineConfig(config: Dbu6Config): Dbu6Config {
  return config;
}

export const CONFIG_FILE = "dbu6.config.ts";

/** A loaded config and the file it came from, for error messages. */
export interface ProjectConfig {
  file: string | null;
  config: Dbu6Config;
}

/**
 * Imports the project's config, or returns an empty one when the project has
 * none. Node runs the file as it is (type stripping), because it sits outside
 * node_modules.
 */
export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { file: null, config: {} };
  const module = (await importProjectFile(file)) as { default?: unknown };
  const config = module.default;
  if (typeof config !== "object" || config === null) {
    throw new Error(
      `${file} must default-export a config: export default defineConfig({ ... }).`,
    );
  }
  return { file, config: config as Dbu6Config };
}

/**
 * Imports one of the project's own TypeScript files. A failure names the
 * file, because the stack of a syntax or resolution error often does not.
 */
export async function importProjectFile(file: string): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ pathToFileURL(file).href);
  } catch (error) {
    throw new Error(`Could not load ${file}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
