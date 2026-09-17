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
      categorization: {
        engine: "nuabase",
        sent_count: 6,
        failed_count: 0,
        error: null,
      },
      opening_balance: 1000,
      closing_balance_from_statement: 2500,
      custom_statement_parser_paths: [
        "custom-built-parsers/hdfc-bank-xls/parser.py",
      ],
      balance_metadata: {
        opening: { extracted: 1000, effective: 1000, source: "statement" },
        closing: { extracted: 2500, effective: 2500, source: "statement" },
      },
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
  it("titles the row with the account and says what came in", () => {
    const summary = describeGroup(group(), [source]);
    expect(summary.tone).toBe("new");
    expect(summary.title).toBe("Sample Bank");
    expect(summary.caption).toBe(
      "HDFC BANK Ltd. · account ending 0505 · 1 Aug to 31 Aug 2026 · Acct_Statement_050505_09092026.xls",
    );
    expect(summary.chip).toBe("6 new");
    expect(summary.counts).toBe("6 in the statement: 6 new");
    expect(summary.balances).toEqual({
      tone: "verified",
      text: "Balances match the statement",
      figures: "₹1,000.00 → ₹2,500.00",
    });
    expect(summary.gpay).toBeNull();
    expect(summary.categorization).toBeNull();
    expect(summary.breakdown).toEqual([]);
    expect(summary.details).toEqual([
      { label: "Ledger account", value: "assets:bank:sample" },
      {
        label: "Read with",
        value:
          "hdfc-bank-xls reader (custom-built-parsers/hdfc-bank-xls/parser.py)",
      },
      {
        label: "Balance sources",
        value: "Opening from the statement, closing from the statement",
        face: "words",
      },
    ]);
  });

  it("says how many descriptions weren't categorized, and why", () => {
    const summary = describeGroup(
      group({
        categorization: {
          engine: "claude-code",
          sent_count: 6,
          failed_count: 6,
          error: "Not logged in",
        },
      }),
    );
    expect(summary.categorization).toEqual({
      text: "Couldn't categorize any of the 6 descriptions with Claude Code",
      reason: "Not logged in",
    });
  });

  it("says nothing about categorizing when nothing new came in", () => {
    const summary = describeGroup(
      group({
        draft_transaction_count: 0,
        duplicate_count: 6,
        draft_duplicate_count: 6,
        categorization: {
          engine: "nuabase",
          sent_count: 6,
          failed_count: 6,
          error: "NUABASE_API_KEY is not set",
        },
      }),
    );
    expect(summary.categorization).toBeNull();
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
    expect(summary.chip).toBe("Nothing new");
    expect(summary.counts).toBe("6 in the statement: 6 already in your books");
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

  it("splits a mixed result into new and already imported", () => {
    const summary = describeGroup(
      group({
        transaction_count: 8,
        draft_transaction_count: 5,
        duplicate_count: 3,
        draft_duplicate_count: 3,
      }),
    );
    expect(summary.chip).toBe("5 new");
    expect(summary.counts).toBe(
      "8 in the statement: 5 new, 3 already in your books",
    );
    expect(summary.breakdown).toEqual([
      { label: "Already waiting in Review from an earlier import", value: "3" },
    ]);
  });

  it("says so when the statement has no transactions", () => {
    const summary = describeGroup(
      group({ transaction_count: 0, draft_transaction_count: 0 }),
    );
    expect(summary.tone).toBe("nothing-new");
    expect(summary.chip).toBe("Nothing new");
    expect(summary.counts).toBe("The statement has no transactions.");
  });

  it("keeps where a balance came from in the details", () => {
    const summary = describeGroup(
      group({
        balance_metadata: {
          opening: { extracted: null, effective: 1000, source: "checkpoint" },
          closing: { extracted: null, effective: 2500, source: "per-row" },
        },
      }),
    );
    expect(summary.balances.tone).toBe("verified");
    expect(summary.details).toContainEqual({
      label: "Balance sources",
      value:
        "Opening from your books' last confirmed balance, closing from the last row's printed balance",
      face: "words",
    });
  });

  it("shows only the closing figure when there is no opening balance", () => {
    const summary = describeGroup(
      group({
        balance_metadata: {
          opening: { extracted: null, effective: null, source: "none" },
          closing: { extracted: 2500, effective: 2500, source: "per-row" },
        },
      }),
    );
    expect(summary.balances).toEqual({
      tone: "verified",
      text: "Balances match the statement",
      figures: "₹2,500.00",
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
    expect(summary.balances).toEqual({
      tone: "unverified",
      text: "Balances not checked: the statement prints no closing balance",
      figures: null,
    });
  });

  it("reads credit-card balances as amounts owed", () => {
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
    expect(summary.balances.figures).toBe("₹1,000.00 owed → ₹2,500.00 owed");
  });

  it("counts the UPI payments Google Pay named", () => {
    expect(describeGroup(group({ gpay_enriched_count: 6 })).gpay).toBe(
      "Named 6 UPI payments from Google Pay",
    );
    expect(describeGroup(group({ gpay_enriched_count: 1 })).gpay).toBe(
      "Named 1 UPI payment from Google Pay",
    );
  });
});
