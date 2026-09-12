import { describe, expect, it } from "vitest";
import type { AutoImportGroupResult } from "dbu6-shared";
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

describe("describeGroup", () => {
  it("leads with the new transactions and verifies the money in one line", () => {
    const summary = describeGroup(group());
    expect(summary.tone).toBe("new");
    expect(summary.headline).toBe(
      "6 new transactions from Sample Bank, ready to review.",
    );
    expect(summary.subline).toBe(
      "Statement 1 Aug to 31 Aug 2026 · Acct_Statement_050505_09092026.xls",
    );
    expect(summary.money).toEqual({
      tone: "verified",
      text: "Balances verified: opening ₹1,000.00 at the start, ₹2,500.00 at the end, net change +₹1,500.00, exactly as the statement prints.",
    });
    expect(summary.alreadyKnown).toEqual([]);
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
    expect(summary.headline).toBe(
      "Nothing new from Sample Bank. All 6 transactions were already in your books.",
    );
    expect(summary.alreadyKnown).toEqual([
      "6 dated on or before your last confirmed balance (31 Aug 2026) were already posted.",
    ]);
    expect(summary.details).toContainEqual({
      label: "Already in your books (on or before 31 Aug 2026)",
      value: "6",
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
    expect(summary.headline).toBe(
      "4 new transactions from Sample Bank. 2 were already in your books.",
    );
    expect(summary.alreadyKnown).toEqual([
      "2 are already waiting in Drafts from an earlier import.",
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
    expect(summary.money.text).toBe(
      "Balances verified: opening ₹1,000.00 at the start, ₹2,500.00 at the end, net change +₹1,500.00, the statement prints no opening balance, so the opening is your books' last confirmed balance; the closing is the last row's printed balance.",
    );
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
    expect(summary.money.tone).toBe("unverified");
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
    expect(summary.money.text).toBe(
      "Balances verified: ₹1,000.00 owed at the start, ₹2,500.00 owed at the end, exactly as the statement prints.",
    );
  });
});
