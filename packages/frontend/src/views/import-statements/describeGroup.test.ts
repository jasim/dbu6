import { describe, expect, it } from "vitest";
import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import { describeGroup } from "./describeGroup";

function group(
  overrides: Partial<AutoImportGroupResult["result"]> = {},
  extra: Partial<AutoImportGroupResult> = {},
): AutoImportGroupResult {
  return {
    preset_name: "Sample Bank",
    base_account: "assets:bank:sample",
    is_credit_card: false,
    file_names: ["Acct_Statement_050505_09092026.xls"],
    ...extra,
    result: {
      hledger_journal: "",
      transaction_count: 6,
      skipped_reconciled_count: 0,
      draft_transaction_count: 6,
      duplicate_count: 0,
      draft_duplicate_count: 0,
      journal_duplicate_count: 0,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
      gpay_enriched_count: 0,
      opening_balance: 1000,
      closing_balance_from_statement: 2500,
      custom_statement_parser_paths: [
        "custom-built-parsers/hdfc-bank-xls/parser.py",
      ],
      balance_metadata: {
        opening: { extracted: 1000, effective: 1000, source: "statement" },
        closing: { extracted: 2500, effective: 2500, source: "statement" },
      },
      warnings: [],
      statement_period: { first_date: "2026-08-01", last_date: "2026-08-31" },
      reconciliation_checkpoint: null,
      ...overrides,
    },
  };
}

const source: AutoImportPlanFile = {
  status: "resolved",
  file_name: "Acct_Statement_050505_09092026.xls",
  parser_path: "custom-built-parsers/hdfc-bank-xls/parser.py",
  account: { kind: "bank", identifier: "05050505050505" },
  institution: "HDFC BANK Ltd.",
  preset_name: "Sample Bank",
};

describe("describeGroup", () => {
  it("titles the card with the account and puts the numbers in tiles", () => {
    const summary = describeGroup(group(), [source]);
    expect(summary.tone).toBe("new");
    expect(summary.title).toBe("Sample Bank");
    expect(summary.caption).toBe(
      "HDFC BANK Ltd. · account ending 0505 · 1 Aug to 31 Aug 2026 · Acct_Statement_050505_09092026.xls",
    );
    expect(summary.verdict).toBe("6 new transactions ready to review.");
    expect(summary.stats).toEqual([
      { label: "New", value: "6" },
      { label: "In statement", value: "6" },
      { label: "Opening", value: "₹1,000.00" },
      { label: "Closing", value: "₹2,500.00" },
      { label: "Net change", value: "+₹1,500.00" },
    ]);
    expect(summary.breakdown).toEqual([]);
    expect(summary.balances).toEqual({
      tone: "verified",
      text: "Verified",
      caption: "Opening and closing balances exactly as the statement prints.",
    });
  });

  it("captions with the period and files alone when the plan rows are missing", () => {
    expect(describeGroup(group()).caption).toBe(
      "1 Aug to 31 Aug 2026 · Acct_Statement_050505_09092026.xls",
    );
  });

  it("says nothing is new when every row was before the last confirmed balance", () => {
    const summary = describeGroup(
      group({
        draft_transaction_count: 0,
        skipped_reconciled_count: 6,
        reconciliation_checkpoint: { date: "2026-08-31", balance: 2500 },
      }),
    );
    expect(summary.tone).toBe("nothing-new");
    expect(summary.verdict).toBe(
      "Nothing new. All 6 transactions were already in your books.",
    );
    expect(summary.stats.slice(0, 3)).toEqual([
      { label: "New", value: "0" },
      { label: "In statement", value: "6" },
      { label: "Already in books", value: "6" },
    ]);
    expect(summary.breakdown).toEqual([
      {
        label: "Posted on or before 31 Aug 2026, your last confirmed balance",
        value: "6",
      },
    ]);
    expect(summary.details).toContainEqual({
      label: "Last confirmed balance",
      value: "₹2,500.00 on 31 Aug 2026",
    });
  });

  it("splits a mixed result into new and already-imported", () => {
    const summary = describeGroup(
      group({
        draft_transaction_count: 4,
        duplicate_count: 2,
        draft_duplicate_count: 2,
      }),
    );
    expect(summary.verdict).toBe("4 new transactions ready to review.");
    expect(summary.stats).toContainEqual({
      label: "Already in books",
      value: "2",
    });
    expect(summary.breakdown).toEqual([
      { label: "Already waiting in Drafts from an earlier import", value: "2" },
    ]);
  });

  it("explains where a balance came from when not from the statement", () => {
    const summary = describeGroup(
      group({
        balance_metadata: {
          opening: { extracted: null, effective: 1000, source: "checkpoint" },
          closing: { extracted: null, effective: 2500, source: "per-row" },
        },
      }),
    );
    expect(summary.balances).toEqual({
      tone: "verified",
      text: "Verified",
      caption:
        "Opening taken from your books' last confirmed balance, as the statement prints none; closing taken from the last row's printed balance.",
    });
  });

  it("flags an unverifiable statement instead of pretending", () => {
    const summary = describeGroup(
      group({
        balance_metadata: {
          opening: { extracted: null, effective: null, source: "none" },
          closing: { extracted: null, effective: null, source: "none" },
        },
      }),
    );
    expect(summary.balances.tone).toBe("unverified");
    expect(summary.balances.text).toBe("Not verified");
    expect(summary.stats.map((stat) => stat.label)).toEqual([
      "New",
      "In statement",
    ]);
  });

  it("reads credit-card balances as amounts owed, with no net change", () => {
    const summary = describeGroup(
      group(
        {
          balance_metadata: {
            opening: {
              extracted: -1000,
              effective: -1000,
              source: "statement",
            },
            closing: {
              extracted: -2500,
              effective: -2500,
              source: "statement",
            },
          },
        },
        { is_credit_card: true, preset_name: "Sample Card" },
      ),
    );
    expect(summary.title).toBe("Sample Card");
    expect(summary.stats.slice(2)).toEqual([
      { label: "Opening", value: "₹1,000.00 owed" },
      { label: "Closing", value: "₹2,500.00 owed" },
    ]);
  });
});
