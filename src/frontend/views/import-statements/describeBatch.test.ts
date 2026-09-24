import { describe, expect, it } from "vitest";
import type {
  AutoImportGroupResult,
  AutoImportPlanFile,
  CategorizationTally,
} from "../../../shared/index";
import { describeBatch } from "./describeBatch";

/*
 * The headline over a batch that imported: how many new transactions came
 * in, from how many statements, and how many still need a category.
 */

function tally(counts: Partial<CategorizationTally>): CategorizationTally {
  return {
    by_rule: 0,
    by_llm: 0,
    same_account: 0,
    uncategorized: 0,
    accounts: [],
    ...counts,
  };
}

function group(
  fileName: string,
  fresh: number,
  categorization_tally: CategorizationTally,
): AutoImportGroupResult {
  return {
    account_id: 1,
    account_name: "Sample Bank",
    base_account: "Sample Bank",
    is_credit_card: false,
    file_names: [fileName],
    result: {
      hledger_journal: "",
      transaction_count: 10,
      skipped_reconciled_count: 0,
      draft_transaction_count: fresh,
      duplicate_count: 10 - fresh,
      draft_duplicate_count: 10 - fresh,
      journal_duplicate_count: 0,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
      gpay_enriched_count: 0,
      categorization: null,
      categorization_tally,
      base_account_id: 1,
      opening_balance: 1000,
      closing_balance_from_statement: 2500,
      balance_metadata: {
        opening: { extracted: 1000, effective: 1000, source: "statement" },
        closing: { extracted: 2500, effective: 2500, source: "statement" },
      },
      statement_period: { first_date: "2026-08-01", last_date: "2026-08-31" },
      reconciliation_checkpoint: null,
    },
  };
}

function file(fileName: string): AutoImportPlanFile {
  return {
    status: "resolved",
    file_name: fileName,
    saved_path: null,
    parser_path: "sample-bank-xls",
    account: null,
    institution: null,
    account_id: 1,
    account_name: "Sample Bank",
  };
}

function imported(groups: AutoImportGroupResult[]) {
  return describeBatch({
    kind: "imported",
    result: {
      files: groups.flatMap((one) => one.file_names.map(file)),
      groups,
    },
  });
}

describe("describeBatch after an import", () => {
  it("heads with the new transactions and says how many need a category", () => {
    expect(
      imported([
        group("sample-aug.xls", 8, tally({ by_rule: 5, uncategorized: 3 })),
        group("sample-sep.xls", 4, tally({ by_llm: 2, same_account: 2 })),
      ]),
    ).toEqual({
      tone: "ok",
      text: "12 new transactions imported",
      next: "5 entries need to be categorized.",
    });
    expect(
      imported([group("sample-aug.xls", 1, tally({ uncategorized: 1 }))]),
    ).toMatchObject({
      text: "1 new transaction imported",
    });
  });

  it("says when every new transaction is categorized", () => {
    expect(
      imported([group("sample-aug.xls", 8, tally({ by_rule: 8 }))]),
    ).toMatchObject({ next: "All entries categorized." });
  });

  it("says nothing was new when the statements were already in the books", () => {
    expect(
      imported([
        group("sample-aug.xls", 0, tally({})),
        group("sample-sep.xls", 0, tally({})),
      ]),
    ).toEqual({
      tone: "waiting",
      text: "Nothing new",
      next: "Everything in the 2 statements was already in your books.",
    });
  });
});
