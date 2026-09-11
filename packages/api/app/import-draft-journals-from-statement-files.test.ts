import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract, importPresetSchema } from "dbu6-shared";
import * as XLSX from "xlsx";
import api, {
  classifyBatch,
  extractXlsStatements,
  resolveAllowedCustomStatementParserPath,
} from "./import-draft-journals-from-statement-files.js";
import { loadApp } from "../app.js";

function openApiPaths(
  document: unknown,
): Record<string, Record<string, unknown>> {
  return (
    (document as { paths?: Record<string, Record<string, unknown>> }).paths ??
    {}
  );
}

describe("statement upload route discovery", () => {
  it("publishes the statement upload route through ts-rest OpenAPI docs", () => {
    const document = api.generateDocument(undefined, {
      info: { title: "dbu6 test api", version: "0.0.0" },
    });

    expect(
      openApiPaths(document)["/import-draft/statement/upload"]?.post,
    ).toBeDefined();
  });

  it("publishes the mounted /api statement upload route through discovery", () => {
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
      openApiPaths(document)["/api/import-draft/statement/upload"]?.post,
    ).toBeDefined();
    expect(openApiPaths(document)["/api/import-presets"]?.get).toBeDefined();
    expect(
      openApiPaths(document)["/api/draft-transactions/classify-with-gpay"]
        ?.post,
    ).toBeDefined();
    expect(
      openApiPaths(document)["/api/reports/duplicate-drafts"]?.get,
    ).toBeDefined();
  });

  it("no longer publishes the retired per-bank upload routes", () => {
    const mountedApi = new TsRestApi<SapportaEnv>();
    loadApp(mountedApi, {
      conn: undefined as never,
      mailer: undefined as never,
    });
    const paths = openApiPaths(
      mountedApi.generateDocument(
        undefined,
        { info: { title: "dbu6 test api", version: "0.0.0" } },
        { pathPrefix: "/api" },
      ),
    );

    // HDFC and Federal Bank import through the universal statement upload with
    // their deterministic parsers in `import-presets.json`. Re-adding a
    // hardcoded per-bank endpoint would reintroduce a second import path that
    // skips the balance validation in `runStatementImport`.
    expect(paths["/api/import-draft/hdfc-bank/upload"]).toBeUndefined();
    expect(paths["/api/import-draft/federal-bank/upload"]).toBeUndefined();
  });
});

describe("statement upload batch formats", () => {
  it("classifies XLS uploads as a supported batch", () => {
    expect(classifyBatch([new File(["workbook"], "statement.XLS")])).toEqual({
      ok: true,
      kind: "xls",
    });
  });

  it("converts XLS worksheets to CSV text for freeform parsing", async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "dbu6-xls-upload-test-"));
    try {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["Date", "Narration", "Amount"],
          ["2026-08-01", "Coffee", -5],
        ]),
        "Statement",
      );
      const xlsPath = path.join(workDir, "statement.xls");
      await writeFile(
        xlsPath,
        XLSX.write(workbook, { type: "buffer", bookType: "xls" }),
      );

      await expect(extractXlsStatements([xlsPath])).resolves.toEqual([
        {
          sourceName: "statement.xls",
          transactionTexts: ["Date,Narration,Amount\n2026-08-01,Coffee,-5"],
          balanceText: "Date,Narration,Amount\n2026-08-01,Coffee,-5",
        },
      ]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});

describe("custom statement parser preset configuration", () => {
  it("accepts a custom parser path on import presets", () => {
    expect(() =>
      importPresetSchema.parse({
        name: "StanC Bank",
        base_account: "assets:bank:stanc",
        custom_mappings_filenames: ["custom_mappings_federal.prompt"],
        custom_statement_parser_path:
          "custom-built-parsers/stanc-bank-csv/parser.py",
      }),
    ).not.toThrow();
  });

  it("configures the Standard Chartered credit-card preset for automatic custom parsing", () => {
    expect(() =>
      importPresetSchema.parse({
        name: "StanC CC",
        base_account: "cc:stanc",
        custom_mappings_filenames: ["custom_mappings_federal.prompt"],
        is_credit_card: true,
        custom_statement_parser_path:
          "custom-built-parsers/stanc-cc-pdf/parser.py",
      }),
    ).not.toThrow();
  });

  it("resolves only parser paths declared by trusted presets", () => {
    const allowed = new Set(["custom-built-parsers/stanc-bank-csv/parser.py"]);

    expect(
      resolveAllowedCustomStatementParserPath(
        "custom-built-parsers/stanc-bank-csv/parser.py",
        allowed,
      ),
    ).toMatch(/custom-built-parsers\/stanc-bank-csv\/parser\.py$/);

    expect(
      resolveAllowedCustomStatementParserPath(
        "custom-built-parsers/other/parser.py",
        allowed,
      ),
    ).toBeNull();
  });
});

describe("GPay draft classification upload contract", () => {
  it("parses repeated form fields into typed classification input", () => {
    expect(
      draftTransactionsContract.classifyDraftTransactionsWithGPay.body.parse({
        ids: ["12", "34"],
        custom_mappings_filenames: ["federal.prompt", "shared.prompt"],
      }),
    ).toEqual({
      ids: [12, 34],
      custom_mappings_filenames: ["federal.prompt", "shared.prompt"],
    });
  });
});
