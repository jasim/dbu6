/**
 * The server half of a project's reports. Each `<root>/reports/<id>/api.ts`
 * default-exports a `TsRestApi` holding the report's route, written exactly
 * as ours are, and is mounted beside ours on `/api`, so it is private, gets
 * an auth context, and appears in OpenAPI. Finding the file is the only thing
 * that is automatic. A report folder without an `api.ts` has no route of its
 * own, which is allowed: its screen may read our endpoints.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { SapportaEnv, TsRestApi } from "@sapporta/server";
import { importProjectFile } from "./config.js";
import { mountApi } from "./mount.js";
import { addRoutesWithoutCollision } from "./route-collisions.js";

/** The `api.ts` of every report folder in `reportsDir`, in name order. */
export function projectReportApiFiles(reportsDir: string): string[] {
  if (!existsSync(reportsDir)) return [];
  return readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(reportsDir, entry.name, "api.ts"))
    .filter((file) => existsSync(file))
    .sort();
}

/**
 * Imports and mounts the project's report routes on `api`, which is served
 * under `/api`. `existing` is the app `api` will be mounted on, holding the
 * routes already there (the framework's, auth's). Throws, naming the file,
 * when one does not export a `TsRestApi` or repeats an existing route.
 * Returns the files it mounted.
 */
export async function mountProjectReports(
  api: TsRestApi<SapportaEnv>,
  existing: Pick<Hono<SapportaEnv>, "routes">,
  reportsDir: string,
): Promise<string[]> {
  const files = projectReportApiFiles(reportsDir);
  for (const file of files) {
    const module = (await importProjectFile(file)) as { default?: unknown };
    const reportApi = module.default;
    if (!isTsRestApi(reportApi)) {
      throw new Error(
        `${file} must default-export a TsRestApi (from "dbu6/server") holding the report's route.`,
      );
    }
    await addRoutesWithoutCollision({
      target: api,
      prefix: "/api",
      existing,
      source: file,
      add: () => mountApi(api, reportApi),
    });
  }
  return files;
}

// By shape, not `instanceof`: under a linked or duplicated install the
// project's TsRestApi class may be another copy of ours.
function isTsRestApi(value: unknown): value is TsRestApi<SapportaEnv> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { routes?: unknown }).routes) &&
    Array.isArray((value as { docEmitters?: unknown }).docEmitters)
  );
}
