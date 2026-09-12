import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbacusImportRequest, ImportPreset } from "dbu6-shared";

// Preset resolution and request validation run for real; only the ledger
// write at the tail is stubbed, so the tests need no database and never read
// data/user-config/import-presets.json.
const { runStatementImport } = vi.hoisted(() => ({
  runStatementImport: vi.fn(),
}));
vi.mock("../bank-importer/statement-import.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../bank-importer/statement-import.js")
  >()),
  runStatementImport,
}));

import api, { importAbacusStatement } from "./import-draft-abacus.js";
import { BalanceMismatchError } from "../bank-importer/import-errors.js";
import type { StatementImportResult } from "../bank-importer/statement-import.js";

const cardPreset: ImportPreset = {
  name: "Sample Card",
  base_account: "liabilities:card:sample",
  is_credit_card: true,
  custom_mappings_filenames: ["sample_mappings.prompt"],
  statement_account_identifier: "050505XXXXXX0505",
};

const bankPreset: ImportPreset = {
  name: "Sample Bank",
  base_account: "assets:bank:sample",
  custom_mappings_filenames: [],
};

const db = {} as never;
const auth = {} as never;

function request(
  overrides: Partial<AbacusImportRequest["statement"]> = {},
  preset = "Sample Card",
): AbacusImportRequest {
  return {
    preset,
    source_name: "sample-card-2026-09",
    statement: {
      kind: "abacus",
      institution: "Sample Bank",
      opening: -2500,
      closing: -4000,
      rows: [
        {
          date: "2026-09-05",
          narration: "NOPII SAMPLE MERCHANT TWO",
          withdrawal: 1000,
          deposit: 0,
          balance: null,
        },
        {
          date: "2026-09-03",
          narration: "NOPII SAMPLE MERCHANT ONE",
          withdrawal: 500,
          deposit: 0,
          balance: null,
        },
      ],
      ...overrides,
    },
  };
}

function imported(count: number): StatementImportResult {
  return {
    hledger_journal: "",
    transaction_count: count,
    skipped_reconciled_count: 0,
    draft_transaction_count: count,
    duplicate_count: 0,
    draft_duplicate_count: 0,
    journal_duplicate_count: 0,
    legacy_match_count: 0,
    backfilled_count: 0,
    same_account_skips: [],
    gpay_enriched_count: 0,
    opening_balance: -2500,
    closing_balance_from_statement: -4000,
    balance_metadata: {
      opening: { extracted: -2500, effective: -2500, source: "statement" },
      closing: { extracted: -4000, effective: -4000, source: "statement" },
    },
    statement_period: { first_date: "2026-09-03", last_date: "2026-09-05" },
    reconciliation_checkpoint: null,
  };
}

describe("POST /import-draft/abacus request contract", () => {
  async function post(body: unknown) {
    const response = await api.request("/import-draft/abacus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it("rejects a statement without both balances before any import runs", async () => {
    for (const missing of ["opening", "closing"] as const) {
      const { statement, ...rest } = request();
      const { [missing]: _dropped, ...partial } = statement;
      const response = await post({ ...rest, statement: partial });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (response.body.details as { path: string[] }[]).map((issue) =>
          issue.path.join("."),
        ),
      ).toContain(`statement.${missing}`);
    }

    const nulls = await post(request({ opening: null as never }));
    expect(nulls.status).toBe(400);
    expect(runStatementImport).not.toHaveBeenCalled();
  });

  it("rejects a request that names no preset", async () => {
    const { preset: _preset, ...rest } = request();
    const response = await post(rest);

    expect(response.status).toBe(400);
    expect(runStatementImport).not.toHaveBeenCalled();
  });
});

describe("importAbacusStatement", () => {
  beforeEach(() => {
    runStatementImport.mockReset();
  });

  it("imports the statement into the named preset's account", async () => {
    runStatementImport.mockResolvedValue(imported(2));

    const response = await importAbacusStatement(
      request({ account: { kind: "card", identifier: "050505XXXXXX0505" } }),
      [bankPreset, cardPreset],
      db,
      auth,
    );

    expect(response).toEqual({
      status: 200,
      body: {
        preset_name: "Sample Card",
        base_account: "liabilities:card:sample",
        is_credit_card: true,
        file_names: ["sample-card-2026-09"],
        result: imported(2),
      },
    });
    expect(runStatementImport).toHaveBeenCalledTimes(1);
    const [parts, options, , , sourceNames] = runStatementImport.mock.calls[0];
    expect(options).toEqual({
      baseAccount: "liabilities:card:sample",
      accountKind: "credit-card",
      customMappingsFilenames: ["sample_mappings.prompt"],
      gpayHtmlPath: null,
    });
    expect(sourceNames).toEqual(["sample-card-2026-09"]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      opening: -2500,
      closing: -4000,
      institution: "Sample Bank",
      account: { kind: "card", identifier: "050505XXXXXX0505" },
    });
    // Newest-first rows arrive oldest-first.
    expect(
      parts[0].transactions.map((row: { date: string }) => row.date),
    ).toEqual(["2026-09-03", "2026-09-05"]);
  });

  it("labels the source when the request gives no name", async () => {
    runStatementImport.mockResolvedValue(imported(2));
    const { source_name: _name, ...unnamed } = request({}, "Sample Bank");

    const response = await importAbacusStatement(
      unnamed,
      [bankPreset],
      db,
      auth,
    );

    expect(response.status).toBe(200);
    expect(runStatementImport.mock.calls[0][4]).toEqual([
      "freeform transactions",
    ]);
  });

  it("rejects an unknown preset, listing the presets that exist", async () => {
    const response = await importAbacusStatement(
      request({}, "Unknown"),
      [bankPreset, cardPreset],
      db,
      auth,
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "import_preset_not_found",
      preset_names: ["Sample Bank", "Sample Card"],
    });
    expect(runStatementImport).not.toHaveBeenCalled();
  });

  it("refuses a statement that reports another account than the preset's", async () => {
    const response = await importAbacusStatement(
      request({ account: { kind: "card", identifier: "050505XXXXXX0506" } }),
      [cardPreset],
      db,
      auth,
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "statement_account_identifier_mismatch",
      expected_identifier: "050505XXXXXX0505",
      statement_identifier: "050505XXXXXX0506",
    });
    expect(runStatementImport).not.toHaveBeenCalled();
  });

  it("returns the import error's own payload when the import refuses", async () => {
    runStatementImport.mockRejectedValue(
      new BalanceMismatchError(-3500, -4000, 0.01),
    );

    const response = await importAbacusStatement(
      request(),
      [cardPreset],
      db,
      auth,
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "balance_mismatch",
      computed_final: -3500,
      statement_closing: -4000,
    });
  });

  it("rejects rows that run in both date directions as a malformed statement", async () => {
    const row = (date: string) => ({
      date,
      narration: "NOPII SAMPLE",
      withdrawal: 500,
      deposit: 0 as const,
      balance: null,
    });

    const response = await importAbacusStatement(
      request({
        rows: [row("2026-09-03"), row("2026-09-05"), row("2026-09-04")],
      }),
      [cardPreset],
      db,
      auth,
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "abacus_json_parse_failed" });
    expect(runStatementImport).not.toHaveBeenCalled();
  });
});
