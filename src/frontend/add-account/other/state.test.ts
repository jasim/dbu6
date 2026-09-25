import { describe, expect, it } from "vitest";
import type {
  OpeningBalanceAccount,
  OpeningBalances,
} from "../../../shared/index";
import {
  afterRecording,
  nothingLeftTitle,
  otherCard,
  otherHref,
  readOtherUrl,
  recordedNames,
  recordTitle,
  unrecorded,
  type OtherUrl,
} from "./state";

/*
 * /add/other's card is the URL's (PLAN.md card 6 and C1); its accounts are
 * the chart's own and owe accounts with no opening yet.
 */

const url = (search: string): OtherUrl =>
  readOtherUrl(new URLSearchParams(search));

function account(
  over: Partial<OpeningBalanceAccount> & Pick<OpeningBalanceAccount, "name">,
): OpeningBalanceAccount {
  return {
    account_id: 1,
    path: `Assets:${over.name}`,
    account_type: "Asset",
    section: "own",
    first_activity_date: null,
    default_date: "2025-12-31",
    suggested_amount: null,
    opening: null,
    ...over,
  };
}

const OPENING = {
  journal_id: 50501,
  date: "2025-12-31",
  amount: 1000,
  description: "Opening balance",
  locked: null,
};

describe("the URL", () => {
  it("reads the first run and C1 on it", () => {
    expect(url("")).toEqual({ setup: false, record: false });
    expect(url("?run=setup&record=1")).toEqual({ setup: true, record: true });
  });

  it("ignores what C1 has no use for: card 5's ?from, an old ?recorded", () => {
    expect(url("?run=setup&from=2025-01&recorded=12")).toEqual({
      setup: true,
      record: false,
    });
  });

  it("writes each state back", () => {
    expect(otherHref({})).toBe("/add/other");
    expect(otherHref({ setup: true })).toBe("/add/other?run=setup");
    expect(otherHref({ setup: true, record: true })).toBe(
      "/add/other?run=setup&record=1",
    );
  });
});

describe("otherCard", () => {
  it("shows card 6 on the first run, until Add one", () => {
    expect(otherCard(url("?run=setup"))).toBe("anything-else");
    expect(otherCard(url("?run=setup&record=1"))).toBe("record");
  });

  it("goes straight to C1 later, from Home's + Add", () => {
    expect(otherCard(url(""))).toBe("record");
    expect(otherCard(url("?record=1"))).toBe("record");
  });
});

describe("afterRecording", () => {
  it("comes back to card 6 on the first run", () => {
    expect(afterRecording(url("?run=setup&record=1"))).toBe(
      "/add/other?run=setup",
    );
  });

  it("goes Home later", () => {
    expect(afterRecording(url(""))).toBe("/");
  });
});

describe("unrecorded", () => {
  it("offers own then owe accounts with no opening, in tree order, and no bank or card", () => {
    const data: OpeningBalances = {
      equity_account: null,
      accounts: [
        account({
          account_id: 4,
          name: "Sample Car Loan",
          path: "Liabilities:Loans:Sample Car Loan",
          account_type: "Liability",
          section: "owe",
        }),
        account({ account_id: 3, name: "PPF", path: "Assets:Investments:PPF" }),
        account({ account_id: 2, name: "Cash", path: "Assets:Cash" }),
        account({ account_id: 5, name: "EPF", opening: OPENING }),
        account({
          account_id: 6,
          name: "Sample Savings",
          path: "Assets:Bank Accounts:Sample Savings",
          section: "statement",
        }),
        // A group with accounts under it and no opening.
        account({ account_id: 7, name: "Investments", section: null }),
      ],
    };
    expect(unrecorded(data).map((one) => one.name)).toEqual([
      "Cash",
      "PPF",
      "Sample Car Loan",
    ]);
  });
});

describe("recordedNames", () => {
  it("names the own and owe accounts with an opening, from the books", () => {
    const data: OpeningBalances = {
      equity_account: null,
      accounts: [
        account({
          account_id: 4,
          name: "Sample Car Loan",
          path: "Liabilities:Loans:Sample Car Loan",
          account_type: "Liability",
          section: "owe",
          opening: OPENING,
        }),
        account({ account_id: 2, name: "Cash", path: "Assets:Cash" }),
        account({ account_id: 5, name: "EPF", opening: OPENING }),
        account({
          account_id: 6,
          name: "Sample Savings",
          path: "Assets:Bank Accounts:Sample Savings",
          section: "statement",
          opening: OPENING,
        }),
      ],
    };
    expect(recordedNames(data)).toEqual(["EPF", "Sample Car Loan"]);
  });
});

describe("the words", () => {
  it("asks what an asset held, and what the user owed on a liability", () => {
    expect(recordTitle(null)).toBe("Which account?");
    expect(recordTitle({ name: "Cash", account_type: "Asset" })).toBe(
      "What did Cash hold?",
    );
    expect(
      recordTitle({ name: "Sample Car Loan", account_type: "Liability" }),
    ).toBe("What did you owe on Sample Car Loan?");
  });

  it("says why nothing is offered", () => {
    const recorded = account({ name: "Cash", opening: OPENING });
    expect(
      nothingLeftTitle({ equity_account: null, accounts: [recorded] }),
    ).toBe("Every account in your chart has its balance");
    const bank = account({ name: "Sample Savings", section: "statement" });
    expect(nothingLeftTitle({ equity_account: null, accounts: [bank] })).toBe(
      "Your chart has no cash, deposit or loan accounts",
    );
  });
});
