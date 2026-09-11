import { describe, expect, it } from "vitest";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import api from "./import-draft-statements-auto.js";
import { loadApp } from "../app.js";

function openApiPaths(
  document: unknown,
): Record<string, Record<string, unknown>> {
  return (
    (document as { paths?: Record<string, Record<string, unknown>> }).paths ??
    {}
  );
}

describe("automatic statement upload route discovery", () => {
  it("publishes the automatic upload route through ts-rest OpenAPI docs", () => {
    const document = api.generateDocument(undefined, {
      info: { title: "dbu6 test api", version: "0.0.0" },
    });

    expect(
      openApiPaths(document)["/import-draft/statements/auto"]?.post,
    ).toBeDefined();
  });

  it("publishes the mounted /api automatic upload route through discovery", () => {
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

    expect(
      openApiPaths(document)["/api/import-draft/statements/auto"]?.post,
    ).toBeDefined();
  });
});
