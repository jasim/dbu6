import { describe, expect, it } from "vitest";
import type {
  ReviewAccountDetail,
  ReviewDuplicate,
  ReviewFailingCheck,
} from "../../shared/index";
import { PLAN_FIRST_RULE, RUN_PLAN_FIRST_RULE } from "../agent-prompt-rules";
import {
  balanceChecksPrompt,
  duplicatesPrompt,
  fixAccountPrompt,
  fixReviewPrompt,
  PROMPT_ROW_LIMIT,
} from "./agentPrompts";

function duplicate(draft_id: number): ReviewDuplicate {
  return {
    date: "2026-09-05",
    draft_id,
    other_draft_id: null,
    matched_journal_id: 31,
    matched_journal_entry_id: 1204,
    match_kind: "draft-journal",
    match_type: "base-account-payment",
    confidence: 0.8,
    direction: "withdrawal",
    amount: 12000,
    narration: "NOPII CARD PAYMENT",
    other_narration: "NOPII payment received",
    draft_account: "Sample Card",
    matched_account: "Sample Card",
  };
}

function failing(draft_id: number): ReviewFailingCheck {
  return {
    date: "2026-09-05",
    draft_id,
    running_balance: 340000,
    assertion: 330000,
    diff: 10000,
  };
}

function detail(overrides: Partial<ReviewAccountDetail>): ReviewAccountDetail {
  return {
    account: {
      account_id: 7,
      path: "Sample Savings",
      parent_path: null,
      name: "Sample Savings",
      kind: "bank",
      drafts: 21,
      uncategorised: 0,
      on_own_account: 0,
      duplicates: 0,
      balance_checks: 13,
      failing_checks: 0,
      relies_on: [],
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-13" },
      rule_requests: 0,
    },
    checkpoint: { date: "2026-08-31", balance: 250000 },
    has_opening_entry: true,
    no_starting_balance: [],
    closing: { date: "2026-09-13", balance: 330000 },
    failing: [],
    duplicates: [],
    other_accounts: [],
    ...overrides,
  };
}

describe("duplicatesPrompt", () => {
  it("opens with the outcome, then the account's facts and each possible duplicate", () => {
    const prompt = duplicatesPrompt(detail({ duplicates: [duplicate(812)] }));

    expect(prompt).toMatch(
      /^Outcome: Settle 1 possible duplicate in Sample Savings's drafts/,
    );
    expect(prompt).toContain(
      "Account: Sample Savings (Sample Savings, account id 7)",
    );
    expect(prompt).toContain(
      "Drafts waiting in Review: 21, 2026-09-01 to 2026-09-13",
    );
    expect(prompt).toContain(
      "Last statement balance in the books: 250000.00 on 2026-08-31",
    );
    expect(prompt).toContain(
      '- 2026-09-05 · withdrawal 12000.00 · draft 812 "NOPII CARD PAYMENT" · journal 31 "NOPII payment received" (Sample Card) · base-account-payment, 80%',
    );
    // How duplicates are settled is the playbook's; the prompt names it.
    expect(prompt).toContain("Follow `npx dbu6 docs playbook duplicates`.");
    // A user's project holds none of dbu6's source, so no file of it is named.
    expect(prompt).not.toMatch(/packages\/|src\/|\.ts\b/);
    expect(prompt).toContain(PLAN_FIRST_RULE);
    expect(prompt).toMatch(
      /in the playbook, then \*\*Next\*\*: ask whether to apply it\.$/,
    );
  });

  it("lists at most 50 duplicates and leaves the rest to the app", () => {
    const rows = Array.from({ length: PROMPT_ROW_LIMIT + 3 }, (_, i) =>
      duplicate(i + 1),
    );
    const prompt = duplicatesPrompt(detail({ duplicates: rows }));

    expect(prompt.match(/^- 2026-09-05/gm)).toHaveLength(PROMPT_ROW_LIMIT);
    expect(prompt).toContain("and 3 more (read them from the app)");
  });
});

describe("balanceChecksPrompt", () => {
  it("opens with the outcome and lists each failing check", () => {
    const prompt = balanceChecksPrompt(
      detail({ failing: [failing(901), failing(902)], checkpoint: null }),
    );

    expect(prompt).toMatch(
      /^Outcome: Get Sample Savings's 2 failing balance checks to pass/,
    );
    expect(prompt).toContain("Last statement balance in the books: none yet");
    expect(prompt).toContain(
      "- 2026-09-05 · draft 901 · running 340000.00 · statement 330000.00 · difference 10000.00",
    );
    expect(prompt).toContain("Follow `npx dbu6 docs playbook balance-checks`.");
    expect(prompt).not.toMatch(/packages\/|src\/|\.ts\b/);
    expect(prompt).not.toContain("more (read them");
    expect(prompt).toContain(
      'The headings are the ones under "Report" in the playbook, then **Next**: ask whether to apply it.',
    );
  });

  it("lists at most 50 failing checks", () => {
    const rows = Array.from({ length: PROMPT_ROW_LIMIT + 1 }, (_, i) =>
      failing(i + 1),
    );
    const prompt = balanceChecksPrompt(detail({ failing: rows }));

    expect(prompt.match(/^- 2026-09-05/gm)).toHaveLength(PROMPT_ROW_LIMIT);
    expect(prompt).toContain("and 1 more (read them from the app)");
  });
});

describe("fixReviewPrompt", () => {
  it("hands everything left to one run from the drafts, which surveys it", () => {
    const prompt = fixReviewPrompt();

    expect(prompt).toBe(
      [
        "Outcome: Get every account in Review ready for me to add to my books, asking me only what you can't settle.",
        'Follow `npx dbu6 docs run`, starting at its section "Starting from the drafts".',
        RUN_PLAN_FIRST_RULE,
      ].join("\n\n"),
    );
    // A run's report is the guide's, not a per-tab task's.
    expect(prompt).not.toContain(PLAN_FIRST_RULE);
  });

  it("names the one account an Overview hands over", () => {
    const prompt = fixAccountPrompt({
      ...detail({}).account,
      account_id: 3,
      name: "Sample Wallet",
    });

    expect(prompt).toMatch(
      /^Outcome: Get Sample Wallet's drafts ready for me to add to my books/,
    );
    expect(prompt).toContain("Account: Sample Wallet (account id 3)");
    expect(prompt).toContain(
      'starting at its section "Starting from the drafts"',
    );
    // What is left on it is the survey's to read.
    expect(prompt).not.toContain("Duplicates");
  });
});
