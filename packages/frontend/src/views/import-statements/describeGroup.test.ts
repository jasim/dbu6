import { describe, expect, it } from "vitest";
import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import { describeGroup } from "./describeGroup";

function group(
  overrides: Partial<AutoImportGroupResult["result"]> = {},
  extra: Partial<AutoImportGroupResult> = {},
): AutoImportGroupResult {
  return {
    preset_name: "Sample Bank",
    base_account: "Sample Bank",
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
        agent: "claude-code",
        sent_count: 6,
        failed_count: 0,
        error: null,
      },
      categorization_tally: {
        by_rule: 2,
        by_llm: 3,
        same_account: 0,
        uncategorized: 1,
        accounts: [
          { account_id: 7, account_name: "Groceries", count: 3 },
          { account_id: 8, account_name: "Dining", count: 2 },
        ],
      },
      base_account_id: 1,
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
  // The batch imported, so the app kept no copy of the statement.
  saved_path: null,
  parser_path: "custom-built-parsers/hdfc-bank-xls/parser.py",
  account: { kind: "bank", identifier: "05050505050505" },
  institution: "HDFC BANK Ltd.",
  preset_name: "Sample Bank",
};

describe("describeGroup", () => {
  it("titles the row with the account, its number and period, and says what came in", () => {
    const summary = describeGroup(group(), [source]);
    expect(summary).toEqual({
      title: "Sample Bank",
      accountKind: "bank",
      caption: "Bank account ending 0505 · 1 Aug to 31 Aug 2026",
      kind: "new",
      fresh: 6,
      outOf: null,
      categories: { categorized: 5, remaining: 1 },
      problem: null,
      byCategory: [
        { label: "Groceries", value: "3" },
        { label: "Dining", value: "2" },
      ],
      closing: {
        verified: true,
        label: "Closing balance, 31 Aug",
        figure: "₹2,500.00",
      },
      notNew: [],
      details: [
        {
          label: "File",
          value: "Acct_Statement_050505_09092026.xls",
          face: "words",
        },
      ],
    });
  });

  it("captions with the kind of account and the period when the plan rows are missing", () => {
    expect(describeGroup(group()).caption).toBe(
      "Bank account · 1 Aug to 31 Aug 2026",
    );
  });

  it("says why the agent left some uncategorized", () => {
    const summary = describeGroup(
      group({
        categorization: {
          agent: "claude-code",
          sent_count: 6,
          failed_count: 6,
          error: "Not logged in",
        },
      }),
    );
    expect(summary).toMatchObject({
      kind: "new",
      problem: {
        text: "Claude Code couldn't categorize them",
        reason: "Not logged in",
      },
    });
  });

  it("says nothing is new when every row was before the last confirmed balance", () => {
    const summary = describeGroup(
      group({
        draft_transaction_count: 0,
        skipped_reconciled_count: 6,
        reconciliation_checkpoint: { date: "2026-08-31", balance: 2500 },
        categorization: null,
        categorization_tally: {
          by_rule: 0,
          by_llm: 0,
          same_account: 0,
          uncategorized: 0,
          accounts: [],
        },
      }),
    );
    expect(summary).toMatchObject({
      kind: "nothing-new",
      text: "Nothing new: 6 transactions already in your books.",
      notNew: [
        {
          label: "Posted on or before 31 Aug 2026, your last confirmed balance",
          value: "6",
        },
      ],
    });
  });

  it("counts the new out of the statement's rows when some were already in", () => {
    const summary = describeGroup(
      group({
        transaction_count: 8,
        draft_transaction_count: 5,
        duplicate_count: 3,
        draft_duplicate_count: 3,
      }),
    );
    expect(summary).toMatchObject({
      kind: "new",
      fresh: 5,
      outOf: "of 8 in the statement",
      notNew: [
        {
          label: "Already waiting in Review from an earlier import",
          value: "3",
        },
      ],
    });
  });

  it("says so when the statement has no transactions", () => {
    const summary = describeGroup(
      group({ transaction_count: 0, draft_transaction_count: 0 }),
    );
    expect(summary).toMatchObject({
      kind: "nothing-new",
      text: "The statement has no transactions.",
    });
  });

  it("says the closing balance wasn't checked when the statement prints none", () => {
    const summary = describeGroup(
      group({
        balance_metadata: {
          opening: { extracted: null, effective: null, source: "none" },
          closing: { extracted: null, effective: null, source: "none" },
        },
      }),
    );
    expect(summary.closing).toEqual({
      verified: false,
      label: "Closing balance",
      text: "Not checked: the statement prints none",
    });
  });

  it("dates the closing balance by the statement's last row, when it has one", () => {
    expect(
      describeGroup(group({ statement_period: null })).closing,
    ).toMatchObject({ label: "Closing balance" });
  });

  it("reads a credit card's closing balance as an amount owed", () => {
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
    expect(summary).toMatchObject({
      title: "Sample Card",
      accountKind: "card",
      caption: "Credit card · 1 Aug to 31 Aug 2026",
      closing: { figure: "₹2,500.00 owed" },
    });
  });

  it("keeps the files and what Google Pay named in the details", () => {
    const summary = describeGroup(
      group(
        { gpay_enriched_count: 6 },
        { file_names: ["sample-aug.xls", "sample-sep.xls"] },
      ),
    );
    expect(summary.details).toEqual([
      {
        label: "Files",
        value: "sample-aug.xls and sample-sep.xls",
        face: "words",
      },
      { label: "Named from Google Pay", value: "6" },
    ]);
  });
});
