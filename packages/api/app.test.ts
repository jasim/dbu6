import { describe, expect, it } from "vitest";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { loadApp } from "./app.js";

function mountedPaths(): Record<string, Record<string, unknown>> {
  const mountedApi = new TsRestApi<SapportaEnv>();
  loadApp(mountedApi, {
    conn: undefined as never,
    mailer: undefined as never,
  });
  const document = mountedApi.generateDocument(
    undefined,
    { info: { title: "dbu6 test api", version: "0.0.0" } },
    { pathPrefix: "/api" },
  );
  return (
    (document as { paths?: Record<string, Record<string, unknown>> }).paths ??
    {}
  );
}

describe("mounted app routes", () => {
  it("publishes the sub-app routes through /api discovery", () => {
    const paths = mountedPaths();
    expect(paths["/api/import-draft/statements/auto"]?.post).toBeDefined();
    expect(paths["/api/import-presets"]?.get).toBeDefined();
    expect(
      paths["/api/draft-transactions/classify-with-gpay"]?.post,
    ).toBeDefined();
    expect(paths["/api/reports/duplicate-drafts"]?.get).toBeDefined();
  });

  it("no longer publishes the retired statement upload routes", () => {
    const paths = mountedPaths();
    // The hardcoded per-bank uploads and the manual pick-an-account upload,
    // with its LLM extraction and balance overrides, were retired in favour of
    // the automatic endpoint, which recognises each file with a saved parser
    // and resolves its preset.
    expect(paths["/api/import-draft/hdfc-bank/upload"]).toBeUndefined();
    expect(paths["/api/import-draft/federal-bank/upload"]).toBeUndefined();
    expect(paths["/api/import-draft/statement/upload"]).toBeUndefined();
  });
});
