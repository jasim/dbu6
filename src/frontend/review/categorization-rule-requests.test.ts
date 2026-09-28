import { describe, expect, it } from "vitest";
import type {
  CategorizationRuleRequest,
  CategorizationRuleRequestTransaction,
  ReviewAccountDetail,
} from "../../shared/index";
import {
  amountsSeen,
  RULE_REQUEST_TRANSACTION_LIMIT,
  ruleRequestsPrompt,
} from "./categorization-rule-requests";

const detail: ReviewAccountDetail = {
  account: {
    account_id: 7,
    path: "Assets:Sample Card",
    name: "Sample Card",
    kind: "card",
    drafts: 21,
    uncategorised: 4,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    draft_span: { first_date: "2026-09-01", last_date: "2026-09-13" },
  },
  checkpoint: null,
  has_opening_entry: true,
  closing: null,
  failing: [],
  duplicates: [],
  other_accounts: [],
};

// A draft in a rule request: money out, on 2026-09-01, unless given otherwise.
function draft(
  narration: string,
  amount = 100,
  direction: "withdrawal" | "deposit" = "withdrawal",
  date = "2026-09-01",
): CategorizationRuleRequestTransaction {
  return { date, source_narration: narration, direction, amount };
}

function ruleRequest(
  transactions: CategorizationRuleRequestTransaction[],
  note = "",
  name = "Food",
  id = 1,
): CategorizationRuleRequest {
  return {
    id,
    base_account_id: 7,
    transactions,
    account: { id: 12, name },
    note,
  };
}

describe("amountsSeen", () => {
  it("gives the least and most amount each way, money out first", () => {
    expect(
      amountsSeen([
        draft("NOPII A", 300),
        draft("NOPII B", 1000, "deposit"),
        draft("NOPII C", 50),
        draft("NOPII D", 200),
      ]),
    ).toEqual([
      { direction: "withdrawal", count: 3, min: 50, max: 300 },
      { direction: "deposit", count: 1, min: 1000, max: 1000 },
    ]);
  });
});

describe("ruleRequestsPrompt", () => {
  it("numbers each rule request with its drafts, amounts, account and note", () => {
    const prompt = ruleRequestsPrompt(detail, [
      ruleRequest(
        [
          draft("UPI-sample-foodapp-050505", 300),
          draft("UPI-sample-foodapp-050511", 500, "withdrawal", "2026-09-04"),
        ],
        "A food delivery app.",
      ),
      ruleRequest([draft("NOPII PHARMACY 050505", 1000)], "", "Health", 2),
      ruleRequest(
        [draft("NOPII SHOP", 200), draft("NOPII SHOP REFUND", 200, "deposit")],
        "",
        "Shopping",
        3,
      ),
    ]);

    expect(prompt).toContain("/review/7/improve-categorization");
    expect(prompt).toContain(
      "(ledger account Assets:Sample Card, account\nid 7)",
    );
    expect(prompt).toContain(
      [
        '1. 2 drafts go to "Food" (rule request id 1), money out 300.00 to 500.00:',
        "   - 2026-09-01 · out 300.00 · UPI-sample-foodapp-050505",
        "   - 2026-09-04 · out 500.00 · UPI-sample-foodapp-050511",
        "   My note: A food delivery app.",
        "",
        '2. 1 draft goes to "Health" (rule request id 2), money out 1000.00:',
        "   - 2026-09-01 · out 1000.00 · NOPII PHARMACY 050505",
        "",
        '3. 2 drafts go to "Shopping" (rule request id 3), money out 200.00; money in 200.00:',
      ].join("\n"),
    );
  });

  it("asks for a proposal first, and for pushback on drafts alike only in how they were paid", () => {
    const prompt = ruleRequestsPrompt(detail, [
      ruleRequest([draft("NOPII SAMPLE 050505")]),
    ]);

    expect(prompt).toContain("Propose before you change anything.");
    expect(prompt).toContain("If all they share is how they were paid");
    expect(prompt).toContain("never the exact amounts");
    expect(prompt).toContain(
      "check it against the transactions already in my books",
    );
    expect(prompt).toContain("Then stop, and wait for me.");
  });

  it("leaves the choice of rule or guidance to the agent, by the guide", () => {
    const prompt = ruleRequestsPrompt(detail, [
      ruleRequest([draft("NOPII SAMPLE 050505")]),
    ]);

    expect(prompt).toContain("`npx dbu6 docs books`");
    expect(prompt).toContain("user-config/transaction_mappings.mjs");
    expect(prompt).toContain("Don't categorise the drafts yourself");
    expect(prompt).toContain(
      "`npx sapporta api delete /api/categorization-rule-requests/<rule request id>`",
    );
    expect(prompt).not.toContain("My note");
  });

  it("counts the drafts past the limit, and says where to read them", () => {
    const drafts = Array.from(
      { length: RULE_REQUEST_TRANSACTION_LIMIT + 3 },
      (_, i) => draft(`NOPII SAMPLE 050505${i}`),
    );
    const prompt = ruleRequestsPrompt(detail, [ruleRequest(drafts)]);

    expect(prompt).toContain(
      `out 100.00 · NOPII SAMPLE 050505${RULE_REQUEST_TRANSACTION_LIMIT - 1}\n`,
    );
    expect(prompt).not.toContain(
      `NOPII SAMPLE 050505${RULE_REQUEST_TRANSACTION_LIMIT}\n`,
    );
    expect(prompt).toContain(
      "   - and 3 more: `npx sapporta api get /api/categorization-rule-requests --query '{\"base_account_id\":7}'`",
    );
  });
});
