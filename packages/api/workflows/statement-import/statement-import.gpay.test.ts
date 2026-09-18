import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@sapporta/shared/temporal";
import {
  normalizeChronological,
  type Abacus,
  type AbacusStatement,
} from "../../modules/statement/index.js";
import { type Chrono, parseAccount } from "../../modules/values/index.js";
import { parseGPayHtml } from "../../modules/gpay/index.js";
import type { Categorizer } from "../../modules/categorization/index.js";
import type { DraftImportInput, ImportSummary } from "./draft-import.js";
import { runStatementImport, type ImportOptions } from "./statement-import.js";
import { testImportLedger } from "./test-ledger.js";

// Stub the persistence tail so the test can inspect exactly what reaches it.
// Everything before it (key assignment, balance validation, reconciliation
// filtering, GPay enrichment) runs for real.
const draftImportCalls: DraftImportInput[] = [];
vi.mock("./draft-import.js", () => ({
  runDraftImport: async (input: DraftImportInput): Promise<ImportSummary> => {
    draftImportCalls.push(input);
    return {
      hledger_journal: "",
      transaction_count: input.transactions.length,
      skipped_reconciled_count: 0,
      draft_transaction_count: input.transactions.length,
      duplicate_count: 0,
      draft_duplicate_count: 0,
      journal_duplicate_count: 0,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
      categorization: {
        agent: null,
        sent_count: 0,
        failed_count: 0,
        error: null,
      },
    };
  },
}));

const BASE_ACCOUNT = parseAccount("Federal Bank");

// A Federal-style statement: printed per-row balances, verbatim narrations,
// bank references on the UPI rows (reference-keyed identity) and none on the
// charges row (narration-keyed identity).
function statement(): AbacusStatement {
  const rows: Abacus[] = [
    {
      date: "2026-07-01",
      narration: "UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505",
      withdrawal: 500,
      deposit: 0,
      balance: 99500,
      source_reference: "050505000001",
    },
    {
      date: "2026-07-02",
      narration: "UPIOUT/050505000005/q050505@ybl/UPI/0505",
      withdrawal: 1200,
      deposit: 0,
      balance: 98300,
      source_reference: "050505000005",
    },
    {
      date: "2026-07-03",
      narration: "SMS CHARGES sample",
      withdrawal: 60,
      deposit: 0,
      balance: 98240,
    },
  ];
  return {
    transactions: normalizeChronological(rows, "ascending"),
    opening: null,
    closing: null,
    account: null,
    institution: null,
  };
}

// Categorization would read the user's config and run the coding agent's CLI;
// these tests import with no config and an engine that can't call anything.
const noConfig = { ok: false, error: new Error("no config in tests") } as const;
const noCategorizer: Categorizer = {
  classify: noConfig,
  customMappings: noConfig,
  llm: {
    agent: null,
    name: "no engine in tests",
    caller: { ready: false, reason: "no engine in tests" },
  },
};

function options(gpayHtmlPath: string | null): ImportOptions {
  return {
    baseAccount: BASE_ACCOUNT,
    accountKind: "bank",
    categorizer: noCategorizer,
    gpay: gpayHtmlPath === null ? null : parseGPayHtml(gpayHtmlPath),
  };
}

function takeout(dir: string, entries: string): string {
  const file = path.join(dir, "takeout.html");
  writeFileSync(file, entries);
  return file;
}

function keysOf(transactions: Chrono<Abacus>): (string | null | undefined)[] {
  return transactions.map((t) => t.source_transaction_key);
}

describe("Google Pay enrichment on the statement import", () => {
  let dir: string;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "dbu6-gpay-import-"));
    draftImportCalls.length = 0;
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("enriches narrations without changing source_transaction_key", async () => {
    const html = takeout(
      dir,
      `<div>Paid ₹1,200.00 to sample Cafe using Bank Account</div>
       <div>Jul 2, 2026, 9:15 AM</div>`,
    );

    await runStatementImport([statement()], options(null), testImportLedger());
    const plain = draftImportCalls[0].transactions;

    const result = await runStatementImport(
      [statement()],
      options(html),
      testImportLedger(),
    );
    const enriched = draftImportCalls[1].transactions;

    expect(enriched.map((t) => t.narration)).toEqual([
      "UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505",
      "sample Cafe | UPIOUT/050505000005/q050505@ybl/UPI/0505",
      "SMS CHARGES sample",
    ]);
    // Keys were assigned before enrichment, so both runs agree row for row
    // even though the narration handed to categorization differs.
    expect(keysOf(enriched)).toEqual(keysOf(plain));
    expect(keysOf(plain).map((key) => key?.split(":")[0])).toEqual([
      "ref",
      "ref",
      "semantic",
    ]);
    expect(result.gpay_enriched_count).toBe(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "[statement-import] GPay takeout: 1 (date,amount) keys; enriched 1 of 3 narration(s)",
      ),
    );
  });

  it("reports zero enrichments and no narration change without a takeout", async () => {
    const result = await runStatementImport(
      [statement()],
      options(null),
      testImportLedger(),
    );
    expect(result.gpay_enriched_count).toBe(0);
    expect(draftImportCalls[0].transactions.map((t) => t.narration)).toEqual([
      "UPIOUT/050505000001/sample-grocer@okaxis/UPI/0505",
      "UPIOUT/050505000005/q050505@ybl/UPI/0505",
      "SMS CHARGES sample",
    ]);
  });

  it("lets survivors claim activities that an already-reconciled row would otherwise consume", async () => {
    // Two 500 withdrawals on consecutive days; the first is already
    // reconciled. A single takeout activity dated on the reconciled day must
    // still reach the surviving row via the +1-day settlement fallback,
    // which only works because enrichment runs after the filter.
    const rows: Abacus[] = [
      {
        date: "2026-07-01",
        narration: "sample-grocer@okaxis",
        withdrawal: 500,
        deposit: 0,
        balance: 99500,
      },
      {
        date: "2026-07-02",
        narration: "sample-bakery@okaxis",
        withdrawal: 500,
        deposit: 0,
        balance: 99000,
      },
    ];
    const part: AbacusStatement = {
      transactions: normalizeChronological(rows, "ascending"),
      opening: null,
      closing: null,
      account: null,
      institution: null,
    };
    const html = takeout(
      dir,
      `<div>Sent ₹500.00 to sample Bakery</div>
       <div>Jul 1, 2026, 6:00 PM</div>`,
    );

    const result = await runStatementImport(
      [part],
      options(html),
      testImportLedger({
        account: BASE_ACCOUNT,
        date: "2026-07-01",
        balance: 99500,
      }),
    );

    expect(draftImportCalls[0].transactions.map((t) => t.narration)).toEqual([
      "sample Bakery | sample-bakery@okaxis",
    ]);
    expect(result.gpay_enriched_count).toBe(1);
  });
});
