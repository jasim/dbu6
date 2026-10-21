import { describe, expect, it } from "vitest";
import type {
  CategorizationRuleRequest,
  ReviewAccountDetail,
} from "../../shared/index";
import { categorizeWithAgentPrompt } from "./categorize-with-agent";

const detail: ReviewAccountDetail = {
  account: {
    account_id: 7,
    path: "Assets:Sample Card",
    name: "Sample Card",
    kind: "card",
    drafts: 21,
    uncategorised: 4,
    duplicates: 0,
    parent_path: null,
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

const RULE_REQUEST: CategorizationRuleRequest = {
  id: 31,
  base_account_id: 7,
  account: { id: 9, name: "Groceries", parent_path: null },
  transactions: [
    {
      date: "2026-09-01",
      source_narration: "NOPII SHOP",
      direction: "withdrawal",
      amount: 100,
    },
  ],
  note: "",
};

describe("categorizeWithAgentPrompt", () => {
  it("points the agent at the account's drafts without an account, and says how to ask", () => {
    const prompt = categorizeWithAgentPrompt(detail, []);

    expect(prompt).toContain("4 drafts imported for Sample Card");
    expect(prompt).toContain(
      `'{"base_account_id":{"eq":7},"account_id":{"is":"null"}}'`,
    );
    expect(prompt).toContain("/review/7/improve-categorization");
    expect(prompt).toContain("numbered options");
    expect(prompt).toContain("Don't run the categorizer yourself");
    expect(prompt).not.toContain("rule request");
  });

  it("takes the rule requests already made as answers, and deletes each once encoded", () => {
    const prompt = categorizeWithAgentPrompt(detail, [RULE_REQUEST]);

    expect(prompt).toContain("1 rule request");
    expect(prompt).toContain(
      `npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":7}'`,
    );
    expect(prompt).toContain(
      "npx sapporta api delete /api/categorization-rule-requests/<rule request id>",
    );
  });
});
