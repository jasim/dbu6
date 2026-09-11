import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract, importPresetSchema } from "dbu6-shared";
import * as XLSX from "xlsx";
import api, {
  assertStatementAccountMatchesPreset,
  classifyBatch,
  extractXlsStatements,
  resolveAllowedCustomStatementParserPath,
  type ParsedStatementFile,
} from "./import-draft-journals-from-statement-files.js";
import { loadApp } from "../app.js";
import { ApiImportError } from "../bank-importer/import-errors.js";
import type { AbacusStatement } from "../bank-importer/abacus/index.js";
import { unsafeAsChrono } from "../bank-importer/domain/Chrono.js";

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

  it("accepts a canonical statement account identifier on import presets", () => {
    const base = {
      name: "HDFC CC XLS",
      base_account: "cc:hdfc",
      custom_mappings_filenames: [],
      is_credit_card: true,
      custom_statement_parser_path:
        "custom-built-parsers/hdfc-cc-xls/parser.py",
    };
    expect(
      importPresetSchema.parse({
        ...base,
        statement_account_identifier: "050505XXXXXX0505",
      }).statement_account_identifier,
    ).toBe("050505XXXXXX0505");
    for (const bad of ["0505 05XX XXXX 0505", "050505xxxxxx0505", ""]) {
      expect(() =>
        importPresetSchema.parse({
          ...base,
          statement_account_identifier: bad,
        }),
      ).toThrow();
    }
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

describe("statement account guard", () => {
  const generated = (
    account: AbacusStatement["account"],
  ): ParsedStatementFile => ({
    parserPath: "custom-built-parsers/hdfc-cc-xls/parser.py",
    inputPath: "/tmp/upload/statement.xls",
    statement: {
      transactions: unsafeAsChrono([]),
      opening: null,
      closing: null,
      account,
      institution: null,
    },
  });

  it("passes when the preset or the statement has no identifier", () => {
    expect(() =>
      assertStatementAccountMatchesPreset(null, generated(null)),
    ).not.toThrow();
    expect(() =>
      assertStatementAccountMatchesPreset(
        null,
        generated({ kind: "card", identifier: "050505XXXXXX0505" }),
      ),
    ).not.toThrow();
    expect(() =>
      assertStatementAccountMatchesPreset("050505XXXXXX0505", generated(null)),
    ).not.toThrow();
  });

  it("passes when the identifiers agree and rejects with a 422 payload otherwise", () => {
    expect(() =>
      assertStatementAccountMatchesPreset(
        "050505XXXXXX0505",
        generated({ kind: "card", identifier: "050505XXXXXX0505" }),
      ),
    ).not.toThrow();

    let caught: unknown;
    try {
      assertStatementAccountMatchesPreset(
        "050505XXXXXX0505",
        generated({ kind: "card", identifier: "050505XXXXXX0506" }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiImportError);
    const error = caught as ApiImportError;
    expect(error.status).toBe(422);
    expect(error.toPayload()).toMatchObject({
      error: "statement_account_mismatch",
      input_path: "statement.xls",
      parser_path: "custom-built-parsers/hdfc-cc-xls/parser.py",
      expected_identifier: "050505XXXXXX0505",
      statement_account_kind: "card",
      statement_identifier: "050505XXXXXX0506",
    });
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
