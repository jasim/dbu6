import { describe, expect, it } from "vitest";
import type {
  CategorizationRuleRequest,
  CategorizationRuleRequestTransaction,
  ReviewAccountDetail,
} from "../../shared/index";
import { PLAN_FIRST_RULE } from "../agent-prompt-rules";
import {
  amountsSeen,
  RULE_FACTS,
  RULE_REQUEST_TRANSACTION_LIMIT,
  ruleRequestsPrompt,
} from "./categorization-rule-requests";

const detail: ReviewAccountDetail = {
  account: {
    account_id: 7,
    path: "Assets:Sample Card",
    parent_path: null,
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
    account: { id: 12, name, parent_path: null },
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
  it("opens with the outcome, then numbers each rule request with its drafts, amounts, account and note", () => {
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

    expect(prompt).toMatch(
      /^Outcome: Turn my 3 rule requests for Sample Card into categorization rules/,
    );
    expect(prompt).toContain(
      "Account: Sample Card (Assets:Sample Card, account id 7)\nScreen: /review/7/improve-categorization",
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

  it("adds only what the books guide's mapping section leaves easy to get wrong", () => {
    const prompt = ruleRequestsPrompt(detail, [
      ruleRequest([draft("NOPII SAMPLE 050505")]),
    ]);

    expect(prompt).toContain(RULE_FACTS);
    expect(RULE_FACTS).toContain("never its\ndate");
    expect(RULE_FACTS).toContain("How it was paid (UPI, NEFT, card)");
    expect(RULE_FACTS).toContain("60–480 becomes 50–500");
    expect(RULE_FACTS).toContain("Don't run the categorizer");
    expect(RULE_FACTS).toContain("`npx dbu6 docs books`");
    expect(prompt).toContain(
      "`npx sapporta api delete /api/categorization-rule-requests/<rule request id>`",
    );
    expect(prompt).not.toContain("My note");
  });

  it("ends with the plan-first rule and a short report, answer first", () => {
    const prompt = ruleRequestsPrompt(detail, [
      ruleRequest([draft("NOPII SAMPLE 050505")]),
    ]);

    expect(prompt).toContain(PLAN_FIRST_RULE);
    expect(prompt).toMatch(
      /\n\*\*Rules added\*\*: .*\n\*\*Still on my list\*\*: .*\n\*\*Next\*\*: Run categorizer, on Review\.$/,
    );
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
