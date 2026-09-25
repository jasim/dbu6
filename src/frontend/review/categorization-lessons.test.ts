import { describe, expect, it } from "vitest";
import type {
  CategorizationLesson,
  ReviewAccountDetail,
} from "../../shared/index";
import {
  LESSON_NARRATION_LIMIT,
  lessonsPrompt,
} from "./categorization-lessons";

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

function lesson(
  narrations: string[],
  note = "",
  name = "Food",
  id = 1,
): CategorizationLesson {
  return {
    id,
    base_account_id: 7,
    narrations,
    account: { id: 12, name },
    note,
  };
}

describe("lessonsPrompt", () => {
  it("numbers each lesson with its drafts, account and note", () => {
    const prompt = lessonsPrompt(detail, [
      lesson(
        ["UPI-sample-foodapp-050505", "UPI-sample-foodapp-050511"],
        "A food delivery app.",
      ),
      lesson(["NOPII PHARMACY 050505"], "", "Health", 2),
    ]);

    expect(prompt).toContain("/review/7/improve-categorization");
    expect(prompt).toContain(
      "(ledger account Assets:Sample Card,\naccount id 7)",
    );
    expect(prompt).toContain(
      [
        '1. 2 drafts go to "Food" (lesson id 1):',
        "   - UPI-sample-foodapp-050505",
        "   - UPI-sample-foodapp-050511",
        "   My note: A food delivery app.",
        "",
        '2. 1 draft goes to "Health" (lesson id 2):',
        "   - NOPII PHARMACY 050505",
      ].join("\n"),
    );
  });

  it("leaves the choice of rule or guidance to the agent, by the guide", () => {
    const prompt = lessonsPrompt(detail, [lesson(["NOPII SAMPLE 050505"])]);

    expect(prompt).toContain("`dbu6 docs books`");
    expect(prompt).toContain("user-config/transaction_mappings.mjs");
    expect(prompt).toContain("leave them as they are");
    expect(prompt).toContain(
      "`sapporta api delete /api/categorization-lessons/<lesson id>`",
    );
    expect(prompt).not.toContain("My note");
  });

  it("counts the narrations past the limit", () => {
    const narrations = Array.from(
      { length: LESSON_NARRATION_LIMIT + 3 },
      (_, i) => `NOPII SAMPLE 050505${i}`,
    );
    const prompt = lessonsPrompt(detail, [lesson(narrations)]);

    expect(prompt).toContain(
      `   - NOPII SAMPLE 050505${LESSON_NARRATION_LIMIT - 1}`,
    );
    expect(prompt).not.toContain(
      `NOPII SAMPLE 050505${LESSON_NARRATION_LIMIT}\n`,
    );
    expect(prompt).toContain("   - and 3 more like these");
  });
});
