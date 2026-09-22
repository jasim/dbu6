import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations, connectProject } from "@sapporta/server";
import { openDbu6 } from "./open.js";
import { dbu6MigrationsDir, packageDir } from "./paths.js";

// A scratch project under this repository's gitignored tmp/, so the bare
// imports in its files resolve the way they do from a user's node_modules.
// Node imports a project's files itself, not vitest, so they are cached by
// path for the whole run and none of them imports `dbu6/server`, which would
// resolve to a built dist/. Each test therefore writes files of its own name,
// and the one dbu6.config.ts is written once. Sapporta allows one project
// root per process, so the tests share it.
//
// Not tested here: refusing pending migrations. Sapporta's guard is skipped
// when no tables load, and under vitest the schema is .ts it does not load.
let root: string;

const reportApi = (path: string) => `
import { initContract } from "@sapporta/rest-core";
import { TsRestApi } from "@sapporta/server";
import { z } from "zod";

const contract = initContract().router({
  sampleReport: {
    method: "GET",
    path: "${path}",
    responses: { 200: z.object({ total: z.number() }) },
  },
});

const api = new TsRestApi();
api.register("sampleReport", contract.sampleReport, () => ({
  status: 200,
  body: { total: 1000 },
}));
export default api;
`;

function writeReport(id: string, path: string): string {
  const dir = join(root, "reports", id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "api.ts");
  writeFileSync(file, reportApi(path));
  return file;
}

beforeAll(() => {
  mkdirSync(packageDir("tmp"), { recursive: true });
  root = mkdtempSync(packageDir("tmp", "open-test-"));
  vi.stubEnv("DBU6_ROOT", root);
  vi.stubEnv("SAPPORTA_DATA_DIR", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "sample-secret-for-tests-only-0505050505");
  vi.stubEnv("SAPPORTA_PUBLIC_APP_URL", "http://localhost:2398");
  vi.stubEnv("SAPPORTA_MAIL_FROM", "sample@example.com");
  vi.stubEnv("SAPPORTA_MAIL_TRANSPORT", "disabled");
  mkdirSync(join(root, "data"));
  const conn = connectProject(join(root, "data", "sqlite.db"));
  applyMigrations(conn.sqlite, dbu6MigrationsDir());
  conn.sqlite.close();
});

afterEach(() => {
  rmSync(join(root, "reports"), { recursive: true, force: true });
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function openApiPaths(
  app: Awaited<ReturnType<typeof openDbu6>>,
): Promise<string[]> {
  // /api is private, so the document is generated rather than fetched.
  const document = app.api.generateDocument(
    undefined,
    { info: { title: "test", version: "0.0.0" } },
    { pathPrefix: "/api" },
  ) as { paths?: Record<string, unknown> };
  return Object.keys(document.paths ?? {});
}

describe("openDbu6", () => {
  it("mounts a project's report beside ours, and into OpenAPI", async () => {
    writeReport("sample-report", "/reports/sample-report");
    const app = await openDbu6({ root });
    try {
      const paths = await openApiPaths(app);
      expect(paths).toContain("/api/reports/sample-report");
      expect(paths).toContain("/api/reports/trial-balance");
      // Private like ours: an anonymous caller is turned away, not 404ed.
      const response = await app.hono.request("/api/reports/sample-report");
      expect(response.status).toBe(401);
    } finally {
      app.runtime.close();
    }
  });

  it("stops on a report whose route already exists, naming the file", async () => {
    const file = writeReport("sample-collision", "/reports/trial-balance");
    await expect(openDbu6({ root })).rejects.toThrow(
      new RegExp(`${file.replaceAll("\\", "\\\\")} adds the route GET /api/reports/trial-balance`),
    );
  });

  it("stops on a report that does not export a TsRestApi", async () => {
    const file = writeReport("sample-empty", "/reports/sample-empty");
    writeFileSync(file, "export default {};\n");
    await expect(openDbu6({ root })).rejects.toThrow(/must default-export/);
  });

  it("gives the config's seam to the runtime and runs its extend", async () => {
    writeFileSync(
      join(root, "dbu6.config.ts"),
      `
export const loadCategorizer = async () => { throw new Error("sample"); };
export default {
  loadCategorizer,
  extend(app) {
    app.hono.get("/sample-extension", (c) => c.text("sample"));
  },
};
`,
    );
    const app = await openDbu6({ root });
    try {
      const config = await import(
        pathToFileURL(join(root, "dbu6.config.ts")).href
      );
      expect(app.runtime.loadCategorizer).toBe(config.loadCategorizer);
      const response = await app.hono.request("/sample-extension");
      expect(await response.text()).toBe("sample");
    } finally {
      app.runtime.close();
      rmSync(join(root, "dbu6.config.ts"));
    }
  });
});
