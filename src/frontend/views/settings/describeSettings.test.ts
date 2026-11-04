import { describe, expect, it } from "vitest";
import type {
  OpeningBalanceAccount,
  OpeningBalances,
  StatementAccounts,
  TransactionMappingsView,
} from "../../../shared/index";
import { balancesValue, banksValue, rulesValue } from "./describeSettings";

function account(
  id: number,
  section: OpeningBalanceAccount["section"],
  recorded: boolean,
): OpeningBalanceAccount {
  return {
    account_id: id,
    name: `Sample ${id}`,
    path: `Assets:Sample ${id}`,
    account_type: "Asset",
    section,
    first_activity_date: null,
    default_date: null,
    implied_opening: null,
    opening: recorded
      ? ({
          date: "2026-01-01",
          amount: 1000,
        } as OpeningBalanceAccount["opening"])
      : null,
  };
}

describe("banksValue", () => {
  it("counts the banks and cards", () => {
    const data = (count: number) =>
      ({
        accounts: Array.from({ length: count }),
      }) as unknown as StatementAccounts;
    expect(banksValue(data(0))).toEqual({ tone: "quiet", text: "None yet" });
    expect(banksValue(data(1))).toEqual({ tone: "plain", text: "1 account" });
    expect(banksValue(data(4))).toEqual({ tone: "plain", text: "4 accounts" });
  });
});

describe("balancesValue", () => {
  it("counts the accounts that have a balance", () => {
    const data: OpeningBalances = {
      equity_account: null,
      accounts: [
        account(1, "own", true),
        account(2, "statement", false),
        account(3, "owe", true),
        account(4, null, false),
      ],
    };
    expect(balancesValue(data)).toEqual({
      tone: "plain",
      text: "2 recorded",
    });
  });

  it("says when none is recorded", () => {
    expect(balancesValue({ equity_account: null, accounts: [] })).toEqual({
      tone: "quiet",
      text: "None yet",
    });
  });
});

describe("rulesValue", () => {
  it("counts the exact and contains rules", () => {
    const data = {
      state: "read",
      filename: "transaction_mappings.mjs",
      exact: [{}, {}],
      contains: [{}],
    } as unknown as TransactionMappingsView;
    expect(rulesValue(data)).toEqual({ tone: "plain", text: "3 rules" });
  });

  it("says when the rules file can't be read", () => {
    expect(
      rulesValue({
        state: "unreadable",
        filename: "transaction_mappings.mjs",
        error: "SyntaxError",
      }),
    ).toEqual({
      tone: "attention",
      text: "transaction_mappings.mjs can't be read",
    });
  });
});
