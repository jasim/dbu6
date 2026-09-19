// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AutoImportGroupResult,
  CategorizationReport,
  CategorizationTally,
} from "dbu6-shared";
import { ResultsCard } from "./cards";

/*
 * An account's row in the import results: the new transactions and whether
 * they still need a category as figures, the closing balance, and the
 * categories folded away. Who categorized them is not the user's concern.
 */

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function group(result: {
  fresh: number;
  total: number;
  tally: CategorizationTally;
  categorization?: CategorizationReport;
}): AutoImportGroupResult {
  return {
    preset_name: "Sample Savings",
    base_account: "Sample Savings",
    is_credit_card: false,
    file_names: ["sample-aug.xls"],
    result: {
      hledger_journal: "",
      transaction_count: result.total,
      skipped_reconciled_count: 0,
      draft_transaction_count: result.fresh,
      duplicate_count: result.total - result.fresh,
      draft_duplicate_count: result.total - result.fresh,
      journal_duplicate_count: 0,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
      gpay_enriched_count: 0,
      categorization: result.categorization ?? {
        agent: "claude-code",
        sent_count: 4,
        failed_count: 0,
        error: null,
      },
      categorization_tally: result.tally,
      base_account_id: 5,
      opening_balance: 10000,
      closing_balance_from_statement: 25000,
      balance_metadata: {
        opening: { extracted: 10000, effective: 10000, source: "statement" },
        closing: { extracted: 25000, effective: 25000, source: "statement" },
      },
      statement_period: { first_date: "2026-08-01", last_date: "2026-08-31" },
      reconciliation_checkpoint: null,
    },
  };
}

const ACCOUNTS = [
  { account_id: 7, account_name: "Groceries", count: 20 },
  { account_id: 8, account_name: "Dining", count: 15 },
];

function render(...groups: AutoImportGroupResult[]) {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(ResultsCard, { groups, sources: [] }),
      ),
    );
  });
}

const text = () => host.textContent ?? "";
const link = (words: string) =>
  [...host.querySelectorAll("a")].find((a) => a.textContent === words);

const NOTHING_CATEGORIZED = {
  by_rule: 0,
  by_llm: 0,
  same_account: 0,
  uncategorized: 0,
  accounts: [],
};

describe("an account's card in the import results", () => {
  it("gives each account its own card, headed by its name and kind", () => {
    const bank = group({ fresh: 0, total: 6, tally: NOTHING_CATEGORIZED });
    const card = {
      ...group({ fresh: 0, total: 6, tally: NOTHING_CATEGORIZED }),
      preset_name: "Sample Card",
      is_credit_card: true,
    };
    render(bank, card);

    const cards = [...host.querySelectorAll("ul > li")];
    expect(
      cards.map((one) => [
        one.querySelector("h2")?.textContent,
        one.querySelector("h2 + p")?.textContent,
      ]),
    ).toEqual([
      ["Sample Savings", "Bank account · 1 Aug to 31 Aug 2026"],
      ["Sample Card", "Credit card · 1 Aug to 31 Aug 2026"],
    ]);
  });

  it("counts what came in and what still needs a category, linked to those drafts", () => {
    render(
      group({
        fresh: 40,
        total: 40,
        tally: {
          by_rule: 24,
          by_llm: 11,
          same_account: 1,
          uncategorized: 4,
          accounts: ACCOUNTS,
        },
      }),
    );

    expect(text()).toContain("New40");
    expect(text()).toContain("Categorized35");
    expect(text()).toContain("Need a category5");
    expect(link("Categorize")?.getAttribute("href")).toBe(
      "/review/5/drafts?filter%5Baccount_id%5D%5Bis%5D=null",
    );
    expect(text()).toContain("Closing balance, 31 Aug₹25,000.00");
    expect(text()).toContain("By category (2)");
    expect(text()).not.toContain("All entries categorized");
    expect(text()).not.toMatch(/your rules|Claude Code/);
  });

  it("says all entries are categorized in one box when none need a category", () => {
    render(
      group({
        fresh: 8,
        total: 12,
        tally: {
          by_rule: 8,
          by_llm: 0,
          same_account: 0,
          uncategorized: 0,
          accounts: ACCOUNTS,
        },
      }),
    );

    expect(text()).toContain("New8of 12 in the statement");
    expect(text()).toContain("All entries categorized");
    expect(text()).not.toContain("Need a category");
    expect(text()).not.toContain("Categorized8");
  });

  it("says why the agent left some uncategorized and links to running it again", () => {
    render(
      group({
        fresh: 12,
        total: 12,
        tally: {
          by_rule: 4,
          by_llm: 0,
          same_account: 0,
          uncategorized: 8,
          accounts: [],
        },
        categorization: {
          agent: "claude-code",
          sent_count: 7,
          failed_count: 7,
          error: "Not logged in",
        },
      }),
    );

    expect(text()).toContain("Claude Code couldn't categorize them.");
    expect(text()).toContain("Not logged in");
    expect(link("run the categoriser again")?.getAttribute("href")).toBe(
      "/views/reclassify-drafts?account=5",
    );
  });

  it("says nothing was new, without figures", () => {
    render(
      group({
        fresh: 0,
        total: 6,
        tally: {
          by_rule: 0,
          by_llm: 0,
          same_account: 0,
          uncategorized: 0,
          accounts: [],
        },
      }),
    );

    expect(text()).toContain(
      "Nothing new: 6 transactions already in your books.",
    );
    expect(text()).not.toContain("Need a category");
    expect(text()).not.toContain("By category");
  });
});
