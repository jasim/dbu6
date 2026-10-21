import { describe, expect, it } from "vitest";
import type {
  ReviewAccountDetail,
  ReviewDuplicate,
  ReviewFailingCheck,
} from "../../shared/index";
import { PLAN_FIRST_RULE } from "../agent-prompt-rules";
import {
  balanceChecksPrompt,
  duplicatesPrompt,
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
      duplicates: 0,
      balance_checks: 13,
      failing_checks: 0,
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-13" },
    },
    checkpoint: { date: "2026-08-31", balance: 250000 },
    has_opening_entry: true,
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
    // How duplicates are found is the books guide's; the prompt names it.
    expect(prompt).toMatch(/"Is this a duplicate\?" in\s`npx dbu6 docs books`/);
    // A user's project holds none of dbu6's source, so no file of it is named.
    expect(prompt).not.toMatch(/packages\/|src\/|\.ts\b/);
    expect(prompt).toContain(PLAN_FIRST_RULE);
    expect(prompt).toMatch(/\n\*\*Next\*\*: ask whether to apply it\.$/);
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
    expect(prompt).toMatch(
      /"When a balance\scheck fails" in\s`npx dbu6 docs books`/,
    );
    expect(prompt).not.toMatch(/packages\/|src\/|\.ts\b/);
    expect(prompt).not.toContain("more (read them");
    expect(prompt).toContain("**What's wrong**: why the running balance");
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
