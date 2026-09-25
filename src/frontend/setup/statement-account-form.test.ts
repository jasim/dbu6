import { describe, expect, it } from "vitest";
import type {
  StatementAccountRow,
  StatementAccounts,
} from "../../shared/index";
import {
  draftOf,
  formLayout,
  newDraft,
  numberField,
  knownInstitution,
  readDraft,
  refusalField,
  suggestedName,
  underMoreOptions,
  withInstitution,
  withName,
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
    // An expense that happens to have the name a card would get.
    "Expense Credit Card",
  ],
};

// A bank with no account yet, and its account's name as the form fills it.
const other = (kind: "bank" | "card" = "bank") =>
  withInstitution(newDraft(DATA, kind), "Other Bank", DATA);

describe("the name a new account gets", () => {
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
    expect(suggestedName("card", "Expense Bank", DATA)).toBe(
      "Expense Credit Card 2",
    );
  });

  it("stays as it was when an account is edited", () => {
    const draft = withInstitution(draftOf(savings), "Other Bank", DATA);
    expect(draft.name).toBe("Sample Bank Savings");
  });
});

describe("which fields the form shows", () => {
  it("keeps the number under More options while it is optional", () => {
    const layout = formLayout(other(), DATA, null);
    expect(layout.other).toBeNull();
    expect(numberField("bank", layout, "Other Bank").caption).toBe(
      "Optional. Read from the first statement.",
    );
  });

  it("asks for the number when the bank has another account", () => {
    const draft = withInstitution(newDraft(DATA, "bank"), "Sample Bank", DATA);
    const layout = formLayout(draft, DATA, null);
    expect(layout.other).toBe(savings);
    expect(numberField("bank", layout, "Sample Bank").caption).toBe(
      "Sample Bank already has Sample Bank Savings. This tells their statements apart.",
    );
    expect(numberField("card", layout, "Sample Bank").caption).toBe(
      "As printed on the statement, e.g. XXXX XXXX XXXX 0505.",
    );
    // The account being edited doesn't count against itself.
    expect(formLayout(draftOf(savings), DATA, savings).other).toBeNull();
  });

  it("shows Under when there is no parent to start from", () => {
    expect(formLayout(other(), DATA, null).parentInView).toBe(false);
    expect(formLayout(other("card"), DATA, null).parentInView).toBe(true);
    expect(
      formLayout(draftOf(savings), DATA, { ...savings, parent: null })
        .parentInView,
    ).toBe(true);
  });

  it("shows Under when the bank accounts sit under different parents", () => {
    const mixed = { ...DATA, mixed_parents: { bank: true, card: false } };
    const layout = formLayout(other(), mixed, null);
    expect(layout.parentInView).toBe(true);
    expect(underMoreOptions("parent", layout)).toBe(false);
    // It still starts from the parent most of them share.
    expect(newDraft(mixed, "bank").parentId).toBe(2);
  });

  it("offers an account already in the books for a new row of its type", () => {
    expect(formLayout(other(), DATA, null).canUseExisting).toBe(true);
    expect(formLayout(other("card"), DATA, null).canUseExisting).toBe(false);
    expect(formLayout(draftOf(savings), DATA, savings).canUseExisting).toBe(
      false,
    );
  });
});

describe("the bank typed", () => {
  it("is the known one when only case or spaces differ", () => {
    const banks = ["Sample Bank", "Other Bank"];
    expect(knownInstitution(banks, "  sample   BANK ")).toBe("Sample Bank");
    expect(knownInstitution(banks, " New  Bank ")).toBe("New Bank");
    expect(knownInstitution(banks, "Sample Banking")).toBe("Sample Banking");
    expect(knownInstitution(banks, " ")).toBe("");
  });
});

describe("a problem's field", () => {
  it("is under More options while the field is tucked away there", () => {
    const layout = formLayout(other(), DATA, null);
    expect(underMoreOptions("identifier", layout)).toBe(true);
    expect(underMoreOptions("parent", layout)).toBe(true);
    expect(underMoreOptions("name", layout)).toBe(false);

    // At a bank with another account the number is in view; a card with no
    // parent to start from shows Under.
    const sample = withInstitution(newDraft(DATA, "bank"), "Sample Bank", DATA);
    expect(underMoreOptions("identifier", formLayout(sample, DATA, null))).toBe(
      false,
    );
    const card = other("card");
    expect(underMoreOptions("parent", formLayout(card, DATA, null))).toBe(
      false,
    );
  });

  it("comes from the server's refusal code", () => {
    const refused = (code: string) => ({ body: { error: "NOPII", code } });
    expect(refusalField(refused("identifier_invalid"))).toBe("identifier");
    expect(refusalField(refused("parent_not_suitable"))).toBe("parent");
    expect(refusalField(refused("unknown_account"))).toBeNull();
    expect(refusalField(new Error("NOPII"))).toBeNull();
  });
});

describe("the change an edit sends", () => {
  // Another account at Sample Bank, which Sample Bank Savings is edited
  // alongside.
  const joint: StatementAccountRow = {
    ...savings,
    account_id: 9,
    name: "Sample Bank Joint",
    account_identifiers: ["050505000034"],
  };
  const two = { ...DATA, accounts: [savings, joint] };

  it("updates the row", () => {
    expect(
      readDraft(
        {
          ...withName(draftOf(savings), "Renamed"),
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
    expect(readDraft(withName(draft, " "), DATA, savings)).toEqual({
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
      readDraft({ ...draftOf(savings), identifier: "" }, two, savings),
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
