import { describe, expect, it } from "vitest";
import {
  NO_DRAFTS,
  postingChecks,
  type PostingBlock,
} from "../../shared/index";
import { checkText } from "./posting-checks";
import { REVIEW_TABS } from "./routes";

describe("checkText", () => {
  it("says a passing check the way Overview and the tabs both show it", () => {
    expect(
      postingChecks({
        ...NO_DRAFTS,
        drafts: 21,
        balance_checks: 13,
      }).map(checkText),
    ).toEqual([
      "All 21 transactions go to an account",
      "No possible duplicates",
      "Your books agree with the bank",
    ]);
    expect(postingChecks({ ...NO_DRAFTS, drafts: 1 }).map(checkText)).toEqual([
      "The transaction goes to an account",
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
      "1 transaction needs an account",
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
      "2 transactions need an account",
      "2 possible duplicates",
      "2 balance checks fail",
    ]);
  });

  it("names drafts on their own statement's account rather than calling them uncategorized", () => {
    const [one, two] = [1, 2].map(
      (onOwn) =>
        postingChecks({
          ...NO_DRAFTS,
          drafts: 3,
          uncategorised: 1,
          on_own_account: onOwn,
        }).map(checkText)[0],
    );
    expect([one, two]).toEqual([
      "1 transaction goes to the account it came from",
      "2 transactions go to the account it came from",
    ]);
  });
});

describe("balance checks that count another account's drafts", () => {
  const refusal = (
    relies_on: { account_id: number; name: string }[],
  ): PostingBlock => ({
    kind: "balance-checks",
    state: "blocks",
    severity: "problem",
    count: 1,
    relies_on,
  });

  it("say which accounts the drafts go in with, when the posting gate names them", () => {
    const savings = { account_id: 1, name: "Sample Savings" };
    const wallet = { account_id: 2, name: "Sample Wallet" };
    expect(checkText(refusal([savings]))).toBe("Waits on Sample Savings");
    expect(checkText(refusal([savings, wallet]))).toBe(
      "Waits on Sample Savings and Sample Wallet",
    );
    expect(checkText(refusal([]))).toBe("1 balance check fails");
  });
});

describe("REVIEW_TABS", () => {
  it("follows the checks' order, Improve categorization and Run categorizer after Drafts", () => {
    expect(REVIEW_TABS).toEqual([
      "drafts",
      "improve-categorization",
      "run-categorizer",
      "duplicates",
      "balance-checks",
    ]);
  });
});
