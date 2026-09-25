import { describe, expect, it } from "vitest";
import type {
  AddAccountCandidate,
  StatementAccounts,
} from "../../shared/index";
import {
  confirmDraft,
  confirmLayout,
  readConfirm,
  suggestedName,
  withInstitution,
  withName,
} from "./confirm-form";
import type { Opening } from "./state";

/*
 * Card 4's form says only what the fields in view lack; the rest is the
 * server's to refuse. The number never shows: the statements supply it.
 */

function candidate(
  overrides: Partial<AddAccountCandidate> = {},
): AddAccountCandidate {
  return {
    key: "account:new:bank:050505000012",
    status: "new",
    account: null,
    institution: "Sample Bank",
    institution_listed: true,
    kind: "bank",
    identifier: "050505000012",
    parsers: ["sample-bank-xls"],
    file_names: ["jan.xls"],
    period: { first_date: "2025-01-01", last_date: "2025-01-31" },
    transactions: 20,
    opening: { date: "2024-12-31", amount: 10000 },
    needs_opening: false,
    opening_refusal: null,
    refusal: null,
    ...overrides,
  };
}

const DATA: StatementAccounts = {
  institutions: [
    { name: "Sample Bank", parsers: ["sample-bank-xls"] },
    { name: "Other Sample Bank", parsers: [] },
  ],
  accounts: [],
  parents: {
    bank: [{ id: 1, name: "Bank Accounts", path: "Assets:Bank Accounts" }],
    card: [{ id: 2, name: "Credit Cards", path: "Liabilities:Credit Cards" }],
  },
  default_parents: { bank: 1, card: null },
  mixed_parents: { bank: false, card: false },
  unlisted: [{ id: 7, name: "Cash", path: "Assets:Cash", kind: "bank" }],
  account_names: ["Assets", "Bank Accounts", "Cash"],
};

const PRINTED: Opening = {
  from: "statements",
  date: "2024-12-31",
  amount: 10000,
};

describe("Confirm's form", () => {
  it("opens with the bank's suggested name and the usual group", () => {
    const draft = confirmDraft(candidate(), "bank", DATA);
    expect(draft).toMatchObject({
      institution: "Sample Bank",
      name: "Sample Savings",
      parentId: 1,
    });
    expect(confirmLayout(candidate(), "bank", DATA)).toEqual({
      bank: false,
      groupInView: false,
      canUseExisting: true,
    });
  });

  it("asks for the bank when dbu6 hasn't met it, as the read names it", () => {
    // The server has tidied the printed name and matched it to a known bank.
    const account = candidate({
      institution: "Other Sample Bank",
      institution_listed: false,
    });
    const draft = confirmDraft(account, "bank", DATA);
    expect(draft.institution).toBe("Other Sample Bank");
    expect(draft.name).toBe("Other Sample Savings");
    expect(confirmLayout(account, "bank", DATA).bank).toBe(true);
    expect(readConfirm(account, "bank", PRINTED, draft, DATA)).toEqual({
      ok: true,
      fields: {
        institution: "Other Sample Bank",
        name: "Other Sample Savings",
        parent_id: 1,
      },
    });
    const blank = { ...draft, institution: " " };
    expect(readConfirm(account, "bank", PRINTED, blank, DATA)).toEqual({
      ok: false,
      problem: "Name the bank.",
    });
  });

  it("sends the name and group of a new account at a bank dbu6 knows", () => {
    const draft = confirmDraft(candidate(), "bank", DATA);
    expect(readConfirm(candidate(), "bank", PRINTED, draft, DATA)).toEqual({
      ok: true,
      fields: { name: "Sample Savings", parent_id: 1 },
    });
    expect(
      readConfirm(candidate(), "bank", PRINTED, withName(draft, " "), DATA),
    ).toEqual({ ok: false, problem: "Give the account a name." });
  });

  it("asks for a group on the first card, with none to share", () => {
    const account = candidate({ kind: "card", institution: "Sample Card Co" });
    const draft = confirmDraft(account, "card", DATA);
    expect(draft.parentId).toBeNull();
    expect(confirmLayout(account, "card", DATA).groupInView).toBe(true);
    expect(readConfirm(account, "card", PRINTED, draft, DATA)).toEqual({
      ok: false,
      problem: "Pick a group.",
    });
    expect(
      readConfirm(account, "card", PRINTED, { ...draft, parentId: 2 }, DATA),
    ).toEqual({
      ok: true,
      fields: { name: "Sample Card Co Credit Card", parent_id: 2 },
    });
  });

  it("uses an account from the chart instead of a new one", () => {
    const draft = {
      ...confirmDraft(candidate(), "bank", DATA),
      existingId: 7,
      name: "",
    };
    expect(readConfirm(candidate(), "bank", PRINTED, draft, DATA)).toEqual({
      ok: true,
      fields: { account_id: 7 },
    });
  });

  it("sends the kind and the typed opening only when they were asked", () => {
    const account = candidate({
      kind: null,
      identifier: null,
      needs_opening: true,
    });
    const draft = confirmDraft(account, "card", {
      ...DATA,
      default_parents: { bank: 1, card: 2 },
    });
    expect(
      readConfirm(
        account,
        "card",
        { from: "typed", date: "2024-12-31", amount: -2500 },
        draft,
        { ...DATA, default_parents: { bank: 1, card: 2 } },
      ),
    ).toEqual({
      ok: true,
      fields: {
        kind: "card",
        opening_amount: -2500,
        name: "Sample Credit Card",
        parent_id: 2,
      },
    });
  });

  it("adds a bank or card already set up as it is", () => {
    const account = candidate({
      status: "empty",
      account: { id: 4, name: "Sample Joint" },
    });
    const draft = confirmDraft(account, "bank", DATA);
    expect(readConfirm(account, "bank", PRINTED, draft, DATA)).toEqual({
      ok: true,
      fields: {},
    });
  });
});

describe("the name a new account gets", () => {
  const other = (kind: "bank" | "card" = "bank") =>
    confirmDraft(candidate({ institution: "Other Bank" }), kind, DATA);

  it("follows the bank until the user types one", () => {
    const draft = other();
    expect(draft.name).toBe("Other Savings");
    expect(withInstitution(draft, "Other Bank Two", DATA).name).toBe(
      "Other Bank Two Savings",
    );
    const typed = withName(draft, "Joint Savings");
    expect(withInstitution(typed, "Other Bank Two", DATA).name).toBe(
      "Joint Savings",
    );
  });

  it("names a card after its issuer", () => {
    expect(other("card").name).toBe("Other Credit Card");
  });

  it("is empty with no bank, and numbered when the books have it", () => {
    expect(suggestedName("bank", "  ", DATA)).toBe("");
    expect(suggestedName("bank", "Sample", DATA)).toBe("Sample Savings");
    expect(
      suggestedName("bank", "Sample", {
        ...DATA,
        account_names: [...DATA.account_names, "Sample Savings"],
      }),
    ).toBe("Sample Savings 2");
    // Any account in the books, not only assets and liabilities.
    expect(
      suggestedName("card", "Expense Bank", {
        ...DATA,
        account_names: [...DATA.account_names, "Expense Credit Card"],
      }),
    ).toBe("Expense Credit Card 2");
  });
});
