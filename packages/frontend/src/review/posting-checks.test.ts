import { describe, expect, it } from "vitest";
import { NO_DRAFTS, postingChecks } from "dbu6-shared";
import { checkText } from "./posting-checks";
import { REVIEW_TABS } from "./routes";

describe("checkText", () => {
  it("says a passing check the way Overview and the tabs both show it", () => {
    expect(
      postingChecks({ ...NO_DRAFTS, drafts: 21, balance_checks: 13 }).map(
        checkText,
      ),
    ).toEqual([
      "All 21 transactions have a category",
      "No possible duplicates",
      "Every balance check passes",
    ]);
    expect(postingChecks({ ...NO_DRAFTS, drafts: 1 }).map(checkText)).toEqual([
      "The transaction has a category",
      "No possible duplicates",
      "These drafts have no balance checks",
    ]);
  });

  it("counts what a blocking check flags, with the verb agreeing", () => {
    const one = { ...NO_DRAFTS, drafts: 3, balance_checks: 2 };
    expect(
      postingChecks({
        ...one,
        uncategorised: 1,
        duplicates: 1,
        failing_checks: 1,
      }).map(checkText),
    ).toEqual([
      "1 transaction needs a category",
      "1 possible duplicate",
      "1 balance check fails",
    ]);
    expect(
      postingChecks({
        ...one,
        uncategorised: 2,
        duplicates: 2,
        failing_checks: 2,
      }).map(checkText),
    ).toEqual([
      "2 transactions need a category",
      "2 possible duplicates",
      "2 balance checks fail",
    ]);
  });
});

describe("REVIEW_TABS", () => {
  it("follows the checks' order, categories in the Drafts tab", () => {
    expect(REVIEW_TABS).toEqual(["drafts", "duplicates", "balance-checks"]);
  });
});
