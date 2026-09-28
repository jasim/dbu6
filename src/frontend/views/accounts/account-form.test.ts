import { describe, expect, it } from "vitest";
import {
  accountBranch,
  deleteBlockers,
  draftOf,
  moveNotice,
  nameLocked,
  parentChoices,
  readDraft,
  refusalField,
  typeLock,
  withType,
  type AccountFormContext,
  type AccountRow,
} from "./account-form";

/*
 * The edit form's own logic: Assets (1) > Bank Accounts (2) > Sample Savings
 * (3) and Sample Wallet (4); Expenses (5) > Groceries (6); Equity (7) >
 * Opening Balances (8). Sample Savings is a bank statement's account.
 */

const account = (
  id: number,
  name: string,
  account_type: AccountRow["account_type"],
  parent_id: number | null,
): AccountRow => ({ id, name, account_type, parent_id });

const CHART: AccountRow[] = [
  account(1, "Assets", "Asset", null),
  account(2, "Bank Accounts", "Asset", 1),
  account(3, "Sample Savings", "Asset", 2),
  account(4, "Sample Wallet", "Asset", 2),
  account(5, "Expenses", "Expense", null),
  account(6, "Groceries", "Expense", 5),
  account(7, "Equity", "Equity", null),
  account(8, "Opening Balances", "Equity", 7),
  account(9, "Income", "Revenue", null),
  account(10, "Salary", "Revenue", 9),
];

const CONTEXT: AccountFormContext = {
  chart: CHART,
  statementAccounts: new Set([3]),
};

describe("accountBranch", () => {
  it("holds the account and everything under it", () => {
    expect([...accountBranch(CHART, 2)].sort()).toEqual([2, 3, 4]);
    expect([...accountBranch(CHART, 6)]).toEqual([6]);
  });
});

describe("parentChoices", () => {
  it("offers only the account's own type", () => {
    expect(parentChoices(CHART, "Expense", 2).map((one) => one.name)).toEqual([
      "Expenses",
      "Groceries",
    ]);
  });

  it("leaves out the account itself and its branch", () => {
    expect(parentChoices(CHART, "Asset", 2).map((one) => one.name)).toEqual([
      "Assets",
    ]);
    // A leaf does not exclude itself from another account's choices.
    expect(parentChoices(CHART, "Asset", null).map((one) => one.name)).toEqual([
      "Assets",
      "Bank Accounts",
      "Sample Savings",
      "Sample Wallet",
    ]);
  });

  it("names each choice by its path in the tree", () => {
    expect(parentChoices(CHART, "Expense", null)[1].path).toBe(
      "Expenses:Groceries",
    );
  });
});

describe("withType", () => {
  it("keeps a parent of the new type", () => {
    const draft = draftOf(CHART[2]);
    expect(withType(draft, "Asset", CHART, 3).parent_id).toBe(2);
  });

  it("clears a parent that no longer fits", () => {
    const draft = draftOf(CHART[2]);
    expect(withType(draft, "Expense", CHART, 3)).toEqual({
      name: "Sample Savings",
      account_type: "Expense",
      parent_id: null,
    });
  });
});

describe("the locks", () => {
  it("locks a bank or card's type, and anything holding one", () => {
    expect(typeLock(CHART[2], CONTEXT)).toEqual({
      locked: true,
      reason: "bank_or_card",
    });
    expect(typeLock(CHART[8], CONTEXT)).toEqual({ locked: false });
    expect(typeLock(CHART[1], CONTEXT)).toEqual({
      locked: true,
      reason: "bank_or_card",
    });
  });

  it("locks Opening Balances' type and name", () => {
    expect(typeLock(CHART[7], CONTEXT)).toEqual({
      locked: true,
      reason: "opening_balances",
    });
    expect(nameLocked(CHART[7])).toBe(true);
    expect(nameLocked(CHART[1])).toBe(false);
  });
});

describe("moveNotice", () => {
  it("counts the sub-accounts a type change moves", () => {
    expect(
      moveNotice({
        account: CHART[4],
        chart: CHART,
        account_type: "Revenue",
        hasEntries: false,
      }),
    ).toBe(
      "Its 1 sub-account moves to Income with it. They'll show under Income in reports.",
    );
  });

  it("says where an account with entries will show", () => {
    expect(
      moveNotice({
        account: CHART[5],
        chart: CHART,
        account_type: "Revenue",
        hasEntries: true,
      }),
    ).toBe("It'll show under Income in reports.");
  });

  it("says nothing while the type is unchanged, or nothing would move", () => {
    expect(
      moveNotice({
        account: CHART[5],
        chart: CHART,
        account_type: "Expense",
        hasEntries: true,
      }),
    ).toBeNull();
    expect(
      moveNotice({
        account: CHART[5],
        chart: CHART,
        account_type: "Revenue",
        hasEntries: false,
      }),
    ).toBeNull();
  });
});

describe("deleteBlockers", () => {
  it("knows sub-accounts and a bank or card up front", () => {
    expect(deleteBlockers(CHART[8], CONTEXT)).toEqual([
      "Income has 1 sub-account under it; delete it first.",
    ]);
    expect(deleteBlockers(CHART[2], CONTEXT)).toEqual([
      "Sample Savings is a bank or card. Remove it in Settings › Banks & cards.",
    ]);
    // Assets holds a bank, so both are in the way there.
    expect(deleteBlockers(CHART[0], CONTEXT)).toHaveLength(2);
  });

  it("leaves an entry or a draft to the server", () => {
    expect(deleteBlockers(CHART[5], CONTEXT)).toEqual([]);
    expect(deleteBlockers(CHART[3], CONTEXT)).toEqual([]);
  });
});

describe("readDraft", () => {
  it("takes a valid change, trimmed", () => {
    expect(
      readDraft(
        { name: "  Sample Wallet  ", account_type: "Asset", parent_id: 2 },
        CHART[3],
        CONTEXT,
      ),
    ).toEqual({
      ok: true,
      draft: { name: "Sample Wallet", account_type: "Asset", parent_id: 2 },
    });
  });

  it("refuses a missing or taken name", () => {
    expect(
      readDraft(
        { name: "  ", account_type: "Asset", parent_id: null },
        null,
        CONTEXT,
      ),
    ).toMatchObject({ ok: false, field: "name" });
    expect(
      readDraft(
        { name: "Groceries", account_type: "Asset", parent_id: null },
        null,
        CONTEXT,
      ),
    ).toMatchObject({
      ok: false,
      field: "name",
      problem: "Your books already have an account named Groceries.",
    });
  });

  it("refuses Opening Balances under another name", () => {
    expect(
      readDraft(
        { name: "Opening Balance", account_type: "Equity", parent_id: 7 },
        CHART[7],
        CONTEXT,
      ),
    ).toMatchObject({ ok: false, field: "name" });
  });

  it("refuses a parent that is not of the new type", () => {
    expect(
      readDraft(
        { name: "Sample Savings", account_type: "Expense", parent_id: 2 },
        CHART[2],
        CONTEXT,
      ),
    ).toMatchObject({ ok: false, field: "parent_id" });
  });
});

describe("refusalField", () => {
  it("reads the field a 422 body names", () => {
    expect(
      refusalField({ body: { code: "ledger_name_taken", field: "name" } }),
    ).toBe("name");
    expect(refusalField({ body: { code: "has_entries" } })).toBeNull();
    expect(refusalField(new Error("Failed"))).toBeNull();
  });
});
