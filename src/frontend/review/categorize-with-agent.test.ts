import { describe, expect, it } from "vitest";
import type {
  CategorizationRuleRequest,
  ReviewAccountDetail,
} from "../../shared/index";
import { PLAN_FIRST_RULE } from "../agent-prompt-rules";
import { RULE_FACTS } from "./categorization-rule-requests";
import {
  categorizeWithAgentPrompt,
  QUESTIONS_AT_A_TIME,
} from "./categorize-with-agent";

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
  it("opens with the outcome and points the agent at the drafts with no account", () => {
    const prompt = categorizeWithAgentPrompt(detail, []);

    expect(prompt).toMatch(
      /^Outcome: Settle with me where Sample Card's 4 uncategorized drafts go/,
    );
    expect(prompt).toContain("Drafts with no account: 4");
    expect(prompt).toContain(
      `'{"base_account_id":{"eq":7},"account_id":{"is":"null"}}'`,
    );
    expect(prompt).toContain("Screen: /review/7/improve-categorization");
    expect(prompt).toContain(RULE_FACTS);
    expect(prompt).not.toContain("rule request");
  });

  it("settles the sure groups in one list, then asks about the rest a few at a time", () => {
    const prompt = categorizeWithAgentPrompt(detail, []);

    expect(prompt).toContain("every group you're sure of in one list");
    expect(prompt).toContain(`at most ${QUESTIONS_AT_A_TIME} at a time`);
    expect(prompt).toContain("numbered options");
    expect(prompt).toContain(PLAN_FIRST_RULE);
    expect(prompt).toMatch(
      /\n\*\*New rules\*\*: .*\n\*\*Set by hand\*\*: .*\n\*\*Still without an account\*\*: .*\n\*\*Next\*\*: Run categorizer, on Review\.$/,
    );
  });

  it("takes the rule requests already made as answers, and deletes each once encoded", () => {
    const prompt = categorizeWithAgentPrompt(detail, [RULE_REQUEST]);

    expect(prompt).toContain("Rule requests I've made: 1");
    expect(prompt).toContain(
      `npx sapporta api get /api/categorization-rule-requests --query '{"base_account_id":7}'`,
    );
    expect(prompt).toContain(
      "npx sapporta api delete /api/categorization-rule-requests/<rule request id>",
    );
  });
});
