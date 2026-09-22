import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { ImportPreset } from "../../shared/index.js";

// Recognition and preset resolution run for real against the sanitized
// fixtures; only the ledger write at the tail is stubbed, so the tests need
// no database and never read user-config/import-presets.json.
// The engine would detect this machine's coding agents; the import itself is
// stubbed, so nothing categorizes here.
vi.mock("../modules/coding-agent/categorization-llm.js", () => ({
  categorizationLlm: async () => ({
    agent: null,
    name: "no engine in tests",
    caller: { ready: false, reason: "no engine in tests" },
  }),
}));

// The Takeout is parsed for real; the spy records which staged copy was read.
const { parseGPayHtml } = vi.hoisted(() => ({ parseGPayHtml: vi.fn() }));
vi.mock("../modules/gpay/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../modules/gpay/index.js")>();
  parseGPayHtml.mockImplementation(original.parseGPayHtml);
  return { ...original, parseGPayHtml };
});

const { runStatementImport } = vi.hoisted(() => ({
  runStatementImport: vi.fn(),
}));
vi.mock(
  "../workflows/statement-import/statement-import.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../workflows/statement-import/index.js")
    >()),
    runStatementImport,
  }),
);

import type { LoadCategorizer } from "../modules/categorization/index.js";
import importDraftStatementsAutoApi, {
  importStatementsAutomatically,
} from "./import-draft-statements-auto.js";
import { loadDbu6App } from "../mount.js";
import { packageDir, projectRoot } from "../paths.js";
import { ClosingBalanceUnavailable } from "../modules/statement/index.js";
import type { StatementImportResult } from "../workflows/statement-import/index.js";

// The user's categorization config would be read from user-config. Each
// import is handed a stand-in categorizer that says which instructions it was
// loaded with.
const loadCategorizer: LoadCategorizer = async (settings) =>
  ({ customMappingsFilenames: settings.customMappingsFilenames }) as never;

const BANK_PARSER = "hdfc-bank-xls";
const CARD_PARSER = "hdfc-cc-xls";
const SECOND_BANK_PARSER = "federal-bank-xls";

const bankPreset: ImportPreset = {
  name: "Sample Bank",
  base_account: "Sample Bank",
  custom_mappings_filenames: ["sample_mappings.prompt"],
  custom_statement_parser_path: BANK_PARSER,
  statement_account_identifier: "05050505050505",
};

const cardPreset: ImportPreset = {
  name: "Sample Card",
  base_account: "Sample Card",
  is_credit_card: true,
  custom_mappings_filenames: [],
  custom_statement_parser_path: CARD_PARSER,
  statement_account_identifier: "050505XXXXXX0505",
};

const secondBankPreset: ImportPreset = {
  name: "Sample Second Bank",
  base_account: "Sample Second Bank",
  custom_mappings_filenames: [],
  custom_statement_parser_path: SECOND_BANK_PARSER,
};

const ledger = {} as never;

async function fixtureFile(parser: string, uploadedAs: string): Promise<File> {
  const extension = uploadedAs.slice(uploadedAs.lastIndexOf("."));
  const bytes = await readFile(
    packageDir(
      `custom-built-parsers/${parser}/fixtures/sanitized-statement${extension}`,
    ),
  );
  return new File([bytes], uploadedAs);
}

function importedNothing(): StatementImportResult {
  return {
    hledger_journal: "",
    transaction_count: 0,
    skipped_reconciled_count: 0,
    draft_transaction_count: 0,
    duplicate_count: 0,
    draft_duplicate_count: 0,
    journal_duplicate_count: 0,
    legacy_match_count: 0,
    backfilled_count: 0,
    same_account_skips: [],
    gpay_enriched_count: 0,
    categorization: {
      agent: null,
      sent_count: 0,
      failed_count: 0,
      error: null,
    },
    categorization_tally: {
      by_rule: 0,
      by_llm: 0,
      same_account: 0,
      uncategorized: 0,
      accounts: [],
    },
    base_account_id: 1,
    opening_balance: null,
    closing_balance_from_statement: null,
    balance_metadata: {
      opening: { extracted: null, effective: null, source: "none" },
      closing: { extracted: null, effective: null, source: "none" },
    },
    statement_period: null,
    reconciliation_checkpoint: null,
  };
}

// A rejected batch keeps its uploads inside the project for the prompt the
// screen offers, so each test runs in a scratch project that is deleted after.
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dbu6-auto-import-"));
  vi.stubEnv("DBU6_ROOT", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

// Narrows the handler's response union to a rejection, so a test that expects
// one reads its body without restating the union.
function rejection(
  response: Awaited<ReturnType<typeof importStatementsAutomatically>>,
) {
  if (response.status === 200) {
    throw new Error("expected the batch to be rejected, but it imported");
  }
  return response.body;
}

/** The batch refused before any account was imported. */
function planRejection(
  response: Awaited<ReturnType<typeof importStatementsAutomatically>>,
) {
  const body = rejection(response);
  if (body.error !== "auto_import_files_unresolved") {
    throw new Error(`expected a plan rejection, got ${body.error}`);
  }
  return body;
}

/** One account's import failed. */
function groupFailure(
  response: Awaited<ReturnType<typeof importStatementsAutomatically>>,
) {
  const body = rejection(response);
  if (!("failed_group" in body)) {
    throw new Error(`expected an account's import to fail, got ${body.error}`);
  }
  return body;
}

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
    const api = importDraftStatementsAutoApi(loadCategorizer);
    const document = api.generateDocument(undefined, {
      info: { title: "dbu6 test api", version: "0.0.0" },
    });

    expect(
      openApiPaths(document)["/import-draft/statements/auto"]?.post,
    ).toBeDefined();
  });

  it("publishes the mounted /api automatic upload route through discovery", () => {
    const mountedApi = new TsRestApi<SapportaEnv>();
    loadDbu6App(mountedApi, { loadCategorizer });
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

describe("automatic statement import", () => {
  beforeEach(() => {
    runStatementImport.mockReset();
    parseGPayHtml.mockClear();
  });

  it("recognises each upload, groups it by preset, and imports once per account", async () => {
    runStatementImport.mockResolvedValue(importedNothing());

    const response = await importStatementsAutomatically(
      {
        statements: [
          await fixtureFile("hdfc-bank-xls", "bank-jan.xls"),
          await fixtureFile("hdfc-cc-xls", "card-jan.xls"),
          await fixtureFile("federal-bank-xls", "second-jan.xls"),
          await fixtureFile("hdfc-bank-xls", "bank-feb.xls"),
        ],
        gpay: null,
      },
      [cardPreset, bankPreset, secondBankPreset],
      ledger,
      loadCategorizer,
    );

    expect(response.status).toBe(200);
    if (response.status !== 200) return;

    expect(response.body.files).toEqual([
      {
        status: "resolved",
        file_name: "bank-jan.xls",
        saved_path: null,
        parser_path: BANK_PARSER,
        account: { kind: "bank", identifier: "05050505050505" },
        institution: "HDFC BANK Ltd.",
        preset_name: "Sample Bank",
      },
      {
        status: "resolved",
        file_name: "card-jan.xls",
        saved_path: null,
        parser_path: CARD_PARSER,
        account: { kind: "card", identifier: "050505XXXXXX0505" },
        institution: "HDFC Bank Cards Division",
        preset_name: "Sample Card",
      },
      {
        status: "resolved",
        file_name: "second-jan.xls",
        saved_path: null,
        parser_path: SECOND_BANK_PARSER,
        account: { kind: "bank", identifier: "050505000012" },
        institution: null,
        preset_name: "Sample Second Bank",
      },
      {
        status: "resolved",
        file_name: "bank-feb.xls",
        saved_path: null,
        parser_path: BANK_PARSER,
        account: { kind: "bank", identifier: "05050505050505" },
        institution: "HDFC BANK Ltd.",
        preset_name: "Sample Bank",
      },
    ]);

    // One group per preset, in the order the accounts first appear, with the
    // two files of the same account kept together in one import.
    expect(
      response.body.groups.map((group) => [
        group.preset_name,
        group.base_account,
        group.is_credit_card,
        group.file_names,
      ]),
    ).toEqual([
      ["Sample Bank", "Sample Bank", false, ["bank-jan.xls", "bank-feb.xls"]],
      ["Sample Card", "Sample Card", true, ["card-jan.xls"]],
      ["Sample Second Bank", "Sample Second Bank", false, ["second-jan.xls"]],
    ]);
    expect(
      response.body.groups.map(
        (group) => group.result.custom_statement_parser_paths,
      ),
    ).toEqual([[BANK_PARSER], [CARD_PARSER], [SECOND_BANK_PARSER]]);

    expect(runStatementImport).toHaveBeenCalledTimes(3);
    const [statements, options, , sourceNames] =
      runStatementImport.mock.calls[1];
    expect(options).toMatchObject({
      baseAccount: "Sample Card",
      accountKind: "card",
      categorizer: { customMappingsFilenames: [] },
      gpay: null,
    });
    expect(sourceNames).toEqual(["card-jan.xls"]);
    expect(statements).toMatchObject([
      { account: { kind: "card", identifier: "050505XXXXXX0505" } },
    ]);
    expect(runStatementImport.mock.calls[0][1]).toMatchObject({
      baseAccount: "Sample Bank",
      accountKind: "bank",
      categorizer: { customMappingsFilenames: ["sample_mappings.prompt"] },
    });
  }, 120_000);

  it("imports nothing when a recognised file has no preset, and explains every file", async () => {
    const response = await importStatementsAutomatically(
      {
        statements: [
          await fixtureFile("hdfc-bank-xls", "bank-jan.xls"),
          await fixtureFile("hdfc-cc-xls", "card-jan.xls"),
        ],
        gpay: null,
      },
      [bankPreset],
      ledger,
      loadCategorizer,
    );

    expect(runStatementImport).not.toHaveBeenCalled();
    expect(response.status).toBe(422);
    const body = planRejection(response);
    expect(body.message).toContain("1 of 2");
    expect(body.files?.[0]).toMatchObject({
      status: "resolved",
      file_name: "bank-jan.xls",
      preset_name: "Sample Bank",
    });
    expect(body.files?.[1]).toMatchObject({
      status: "unresolved",
      file_name: "card-jan.xls",
      parser_path: CARD_PARSER,
      account: { kind: "card", identifier: "050505XXXXXX0505" },
      reason: "no_preset_for_parser",
      candidate_preset_names: [],
    });
  }, 120_000);

  it("rejects a file no saved parser recognises, naming the parsers it tried", async () => {
    const response = await importStatementsAutomatically(
      {
        statements: [
          new File(
            ["date,narration,amount\n2026-01-01,NOPII sample payee,1000\n"],
            "sample-notes.csv",
          ),
        ],
        gpay: null,
      },
      [bankPreset, cardPreset],
      ledger,
      loadCategorizer,
    );

    expect(runStatementImport).not.toHaveBeenCalled();
    expect(response.status).toBe(422);
    const [file] = planRejection(response).files;
    expect(file).toMatchObject({
      status: "unrecognized",
      file_name: "sample-notes.csv",
    });
    expect(
      file?.status === "unrecognized" ? file.candidate_parser_paths : [],
    ).toContain("hdfc-cc-csv");
  }, 120_000);

  it("keeps a rejected batch's uploads in the project, where the reply says", async () => {
    const contents =
      "date,narration,amount\n2026-01-01,NOPII sample payee,1000\n";
    const response = await importStatementsAutomatically(
      { statements: [new File([contents], "sample-notes.csv")], gpay: null },
      [bankPreset],
      ledger,
      loadCategorizer,
    );

    const [file] = planRejection(response).files;
    // A path under the project root, so the coding agent the prompt is
    // handed to opens it from the directory it starts in.
    expect(file?.saved_path).toMatch(
      /^tmp\/statement-uploads\/[^/]+\/0-sample-notes\.csv$/,
    );
    await expect(
      readFile(join(projectRoot(), file?.saved_path ?? ""), "utf8"),
    ).resolves.toBe(contents);
  }, 120_000);

  it("reports the accounts already imported when a later group fails", async () => {
    runStatementImport
      .mockResolvedValueOnce(importedNothing())
      .mockRejectedValueOnce(new ClosingBalanceUnavailable());

    const response = await importStatementsAutomatically(
      {
        statements: [
          await fixtureFile("hdfc-bank-xls", "bank-jan.xls"),
          await fixtureFile("hdfc-cc-xls", "card-jan.xls"),
        ],
        gpay: null,
      },
      [bankPreset, cardPreset],
      ledger,
      loadCategorizer,
    );

    // The failing group keeps the import error's own payload and status.
    expect(response.status).toBe(400);
    const body = groupFailure(response);
    expect(body.error).toBe("closing_balance_unavailable");
    expect(body.imported_groups?.map((one) => one.preset_name)).toEqual([
      "Sample Bank",
    ]);
    expect(body.partial_import).toContain("Sample Bank");
    expect(body.partial_import).toContain("Sample Card");
    expect(body.failed_group).toEqual({
      preset_name: "Sample Card",
      base_account: "Sample Card",
      is_credit_card: true,
      file_names: ["card-jan.xls"],
    });
    expect(body.files).toHaveLength(2);
  }, 120_000);

  it("hands one staged Google Pay takeout to every account's import", async () => {
    runStatementImport.mockResolvedValue(importedNothing());

    const response = await importStatementsAutomatically(
      {
        statements: [
          await fixtureFile("hdfc-bank-xls", "bank-jan.xls"),
          await fixtureFile("hdfc-cc-xls", "card-jan.xls"),
        ],
        gpay: new File(
          ["<html>NOPII sample activity</html>"],
          "My Activity.html",
        ),
      },
      [bankPreset, cardPreset],
      ledger,
      loadCategorizer,
    );

    expect(response.status).toBe(200);
    // The batch parses the staged copy once, and every account's import
    // gets the same index.
    expect(parseGPayHtml).toHaveBeenCalledTimes(1);
    const [path] = parseGPayHtml.mock.calls[0];
    expect(path).toMatch(/\.html$/);
    const indexes = runStatementImport.mock.calls.map(
      ([, options]) => options.gpay,
    );
    expect(indexes).toHaveLength(2);
    expect(indexes[0]).toBe(parseGPayHtml.mock.results[0].value);
    expect(indexes[1]).toBe(indexes[0]);
    // The staged copy is removed once the batch is done.
    await expect(access(path)).rejects.toThrow();
  }, 120_000);
});
