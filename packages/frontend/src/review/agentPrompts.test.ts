import { describe, expect, it } from "vitest";
import type {
  ReviewAccountDetail,
  ReviewDuplicate,
  ReviewFailingCheck,
} from "dbu6-shared";
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
    draft_category: "Sample Card",
    matched_category: "Sample Card",
  };
}

function failing(draft_id: number): ReviewFailingCheck {
  return {
    date: "2026-09-05",
    draft_id,
    running_balance: 336445,
    assertion: 326445,
    diff: 10000,
  };
}

function detail(overrides: Partial<ReviewAccountDetail>): ReviewAccountDetail {
  return {
    account: {
      account_id: 7,
      path: "Sample Savings",
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
    closing: { date: "2026-09-13", balance: 326445 },
    failing: [],
    duplicates: [],
    other_accounts: [],
    ...overrides,
  };
}

describe("duplicatesPrompt", () => {
  it("starts from the account's facts and lists each possible duplicate", () => {
    const prompt = duplicatesPrompt(detail({ duplicates: [duplicate(812)] }));

    expect(prompt).toContain("/review/7/duplicates");
    expect(prompt).toContain(
      "The account is Sample Savings: ledger account Sample Savings, account id\n7.",
    );
    expect(prompt).toContain(
      "It has 21 drafts dated 2026-09-01 to 2026-09-13 waiting in Review.",
    );
    expect(prompt).toContain(
      "Its last posted balance check is 250000.00 on 2026-08-31.",
    );
    expect(prompt).toContain(
      "$SAPPORTA_API_URL/api/reports/duplicate-drafts?base_account_id=7",
    );
    expect(prompt).toContain(
      '- 2026-09-05 · withdrawal 12000.00 · draft 812 "NOPII CARD PAYMENT" (Sample Card) · matched journal 31, entry 1204 "NOPII payment received" (Sample Card) · base-account-payment, confidence 80%',
    );
    expect(prompt).toContain("journal-transaction-matcher.ts");
    expect(prompt).toContain("compared only with other drafts on this account");
    expect(prompt).toContain("shows up as a failing balance check instead");
    expect(prompt).toContain("without first telling me exactly");
    expect(prompt).toContain("050505 / NOPII / sample");
  });

  it("lists at most 50 duplicates and points at the API for the rest", () => {
    const rows = Array.from({ length: PROMPT_ROW_LIMIT + 3 }, (_, i) =>
      duplicate(i + 1),
    );
    const prompt = duplicatesPrompt(detail({ duplicates: rows }));

    expect(prompt.match(/^- 2026-09-05/gm)).toHaveLength(PROMPT_ROW_LIMIT);
    expect(prompt).toContain("and 3 more (read them from the API above)");
  });
});

describe("balanceChecksPrompt", () => {
  it("lists each failing check and explains how the check is computed", () => {
    const prompt = balanceChecksPrompt(
      detail({ failing: [failing(901), failing(902)], checkpoint: null }),
    );

    expect(prompt).toContain(
      "2 balance checks fail in the drafts for Sample Savings",
    );
    expect(prompt).toContain("It has no posted balance check yet.");
    expect(prompt).toContain(
      "- 2026-09-05 · draft 901 · running 336445.00 · statement 326445.00 · difference 10000.00",
    );
    expect(prompt).toContain("running-balance.ts");
    expect(prompt).toContain(
      "$SAPPORTA_API_URL/api/tables/draft_transactions?filter[base_account_id][eq]=7&sort=date,id&limit=1000",
    );
    expect(prompt).not.toContain("more (read them");
  });

  it("lists at most 50 failing checks", () => {
    const rows = Array.from({ length: PROMPT_ROW_LIMIT + 1 }, (_, i) =>
      failing(i + 1),
    );
    const prompt = balanceChecksPrompt(detail({ failing: rows }));

    expect(prompt.match(/^- 2026-09-05/gm)).toHaveLength(PROMPT_ROW_LIMIT);
    expect(prompt).toContain("and 1 more (read them from the API above)");
  });
});
