import { describe, expect, it } from "vitest";
import type {
  StatementAccountRow,
  StatementAccounts,
} from "../../../shared/index";
import {
  draftOf,
  formLayout,
  numberField,
  readDraft,
  refusalField,
  underMoreOptions,
} from "./statement-account-form";

const savings: StatementAccountRow = {
  account_id: 8,
  name: "Sample Bank Savings",
  kind: "bank",
  institution: "Sample Bank",
  account_identifiers: ["050505000012"],
  parent: { id: 2, name: "Bank Accounts" },
  in_ledger: true,
  entries: 0,
  drafts: 0,
};

const DATA: StatementAccounts = {
  institutions: [{ name: "Sample Bank", parsers: [] }],
  accounts: [savings],
  parents: {
    bank: [{ id: 2, name: "Bank Accounts", path: "Assets:Bank Accounts" }],
    card: [{ id: 4, name: "Credit Cards", path: "Liabilities:Credit Cards" }],
  },
  default_parents: { bank: 2, card: null },
  mixed_parents: { bank: false, card: false },
  unlisted: [{ id: 7, name: "Cash", path: "Assets:Cash", kind: "bank" }],
  account_names: [
    "Assets",
    "Bank Accounts",
    "Cash",
    "Liabilities",
    "Credit Cards",
    "Sample Bank Savings",
  ],
};

// Sample Bank Savings, and another account at Sample Bank beside it.
const joint: StatementAccountRow = {
  ...savings,
  account_id: 9,
  name: "Sample Bank Joint",
  account_identifiers: ["050505000034"],
};
const TWO = { ...DATA, accounts: [savings, joint] };

describe("which fields the edit shows", () => {
  it("keeps the number under More options while it is optional", () => {
    const layout = formLayout(draftOf(savings), DATA, savings);
    // The account being edited doesn't count against itself.
    expect(layout.other).toBeNull();
    expect(numberField("bank", layout, "Sample Bank").caption).toBe(
      "Optional. Read from the first statement.",
    );
    expect(underMoreOptions("identifier", layout)).toBe(true);
  });

  it("asks for the number when the bank has another account", () => {
    const layout = formLayout(draftOf(savings), TWO, savings);
    expect(layout.other).toBe(joint);
    expect(numberField("bank", layout, "Sample Bank").caption).toBe(
      "Sample Bank already has Sample Bank Joint. This tells their statements apart.",
    );
    expect(numberField("card", layout, "Sample Bank").caption).toBe(
      "As printed on the statement, e.g. XXXX XXXX XXXX 0505.",
    );
    expect(underMoreOptions("identifier", layout)).toBe(false);
  });

  it("shows Under only when the row has no parent to start from", () => {
    const layout = formLayout(draftOf(savings), DATA, savings);
    expect(layout.parentInView).toBe(false);
    expect(underMoreOptions("parent", layout)).toBe(true);
    const orphan = { ...savings, parent: null };
    const bare = formLayout(draftOf(orphan), DATA, orphan);
    expect(bare.parentInView).toBe(true);
    expect(underMoreOptions("parent", bare)).toBe(false);
    expect(underMoreOptions("name", bare)).toBe(false);
  });
});

describe("a problem's field", () => {
  it("comes from the server's refusal code", () => {
    const refused = (code: string) => ({ body: { error: "NOPII", code } });
    expect(refusalField(refused("identifier_invalid"))).toBe("identifier");
    expect(refusalField(refused("parent_not_suitable"))).toBe("parent");
    expect(refusalField(refused("unknown_account"))).toBeNull();
    expect(refusalField(new Error("NOPII"))).toBeNull();
  });
});

describe("the change an edit sends", () => {
  it("updates the row", () => {
    expect(
      readDraft(
        {
          ...draftOf(savings),
          name: "Renamed",
          identifier: "050505000056",
        },
        DATA,
        savings,
      ),
    ).toEqual({
      ok: true,
      change: {
        action: "update",
        account_id: 8,
        kind: "bank",
        institution: "Sample Bank",
        name: "Renamed",
        identifier: "050505000056",
        parent_id: 2,
      },
    });
  });

  it("names what is missing in plain words", () => {
    const draft = draftOf(savings);
    expect(readDraft({ ...draft, institution: " " }, DATA, savings)).toEqual({
      ok: false,
      problem: "Name the bank.",
      field: "institution",
    });
    expect(
      readDraft({ ...draft, kind: "card", institution: "" }, DATA, {
        ...savings,
        kind: "card",
      }),
    ).toMatchObject({ ok: false, problem: "Name the card issuer." });
    expect(readDraft({ ...draft, name: " " }, DATA, savings)).toEqual({
      ok: false,
      problem: "Give the account a name.",
      field: "name",
    });
    expect(readDraft({ ...draft, parentId: null }, DATA, savings)).toEqual({
      ok: false,
      problem: "Pick the parent account grouping it belongs to.",
      field: "parent",
    });
  });

  it("keeps the number while the bank has another account", () => {
    // Alone at its bank, the number can go.
    expect(
      readDraft({ ...draftOf(savings), identifier: "" }, DATA, savings),
    ).toMatchObject({ ok: true, change: { identifier: null } });
    expect(
      readDraft({ ...draftOf(savings), identifier: "" }, TWO, savings),
    ).toEqual({
      ok: false,
      problem:
        "Sample Bank already has Sample Bank Joint, so each needs its number.",
      field: "identifier",
    });
  });

  it("asks for the other account's number first when it has none", () => {
    const data = {
      ...DATA,
      accounts: [savings, { ...joint, account_identifiers: [] }],
    };
    expect(readDraft(draftOf(savings), data, savings)).toEqual({
      ok: false,
      problem:
        "Add Sample Bank Joint's number first: each account at Sample Bank needs its number.",
      field: "institution",
    });
  });

  it("refuses a number a statement can't print", () => {
    const card: StatementAccountRow = {
      ...savings,
      kind: "card",
      institution: "Sample Issuer",
      parent: { id: 4, name: "Credit Cards" },
    };
    expect(
      readDraft(
        { ...draftOf(card), identifier: "0505 05AB CDEF 0505" },
        DATA,
        card,
      ),
    ).toEqual({
      ok: false,
      problem:
        "That isn't a card number as a statement prints it: digits, with the hidden ones as X.",
      field: "identifier",
    });
    expect(
      readDraft(
        { ...draftOf(card), identifier: "xxxx xxxx xxxx 0505" },
        DATA,
        card,
      ),
    ).toMatchObject({
      ok: true,
      change: { identifier: "xxxx xxxx xxxx 0505" },
    });
    expect(
      readDraft({ ...draftOf(savings), identifier: "0505-05X" }, DATA, savings),
    ).toEqual({
      ok: false,
      problem: "An account number is digits only.",
      field: "identifier",
    });
  });
});
