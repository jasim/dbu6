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
  readDraft,
  suggestedName,
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
  unlisted: [{ id: 7, name: "Cash", path: "Assets:Cash", kind: "bank" }],
};

// A bank with no account yet, and its account's name as the form fills it.
const other = (kind: "bank" | "card" = "bank") =>
  withInstitution(newDraft(DATA, kind), "Other Bank", DATA);

describe("the name a new account gets", () => {
  it("follows the bank until the user types one", () => {
    const draft = other();
    expect(draft.name).toBe("Other Bank Savings");
    expect(withInstitution(draft, "Other Bank Two", DATA).name).toBe(
      "Other Bank Two Savings",
    );

    const typed = withName(draft, "Joint Savings");
    expect(withInstitution(typed, "Other Bank Two", DATA).name).toBe(
      "Joint Savings",
    );
  });

  it("names a card after its issuer", () => {
    expect(other("card").name).toBe("Other Bank Credit Card");
  });

  it("is empty with no bank, and numbered when the books have it", () => {
    expect(suggestedName("bank", "  ", DATA)).toBe("");
    expect(suggestedName("bank", "Sample Bank", DATA)).toBe(
      "Sample Bank Savings 2",
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

  it("offers an account already in the books for a new row of its type", () => {
    expect(formLayout(other(), DATA, null).canUseExisting).toBe(true);
    expect(formLayout(other("card"), DATA, null).canUseExisting).toBe(false);
    expect(formLayout(draftOf(savings), DATA, savings).canUseExisting).toBe(
      false,
    );
  });
});

describe("the change the form sends", () => {
  it("creates a new account under the kind's default parent", () => {
    const draft = withInstitution(newDraft(DATA, "bank"), " Other Bank ", DATA);
    expect(readDraft(draft, DATA, null)).toEqual({
      ok: true,
      change: {
        action: "create",
        kind: "bank",
        institution: "Other Bank",
        identifier: null,
        ledger: { source: "new", name: "Other Bank Savings", parent_id: 2 },
      },
    });
  });

  it("names what is missing in plain words", () => {
    expect(readDraft(newDraft(DATA, "bank"), DATA, null)).toEqual({
      ok: false,
      problem: "Name the bank.",
    });
    expect(readDraft(newDraft(DATA, "card"), DATA, null)).toEqual({
      ok: false,
      problem: "Name the card issuer.",
    });
    expect(readDraft(withName(other(), " "), DATA, null)).toEqual({
      ok: false,
      problem: "Give the account a name.",
    });
    // A card starts with no parent here, as the books have no card yet.
    expect(readDraft(other("card"), DATA, null)).toEqual({
      ok: false,
      problem: "Pick where it sits in your chart.",
    });
  });

  it("asks for a number at a bank that has another account", () => {
    const draft = withInstitution(newDraft(DATA, "bank"), "Sample Bank", DATA);
    expect(readDraft(draft, DATA, null)).toEqual({
      ok: false,
      problem:
        "Sample Bank already has Sample Bank Savings, so each needs its number.",
    });
    expect(
      readDraft({ ...draft, identifier: "050505000034" }, DATA, null),
    ).toMatchObject({ ok: true, change: { identifier: "050505000034" } });
    // The account being edited doesn't count against itself.
    expect(readDraft(draftOf(savings), DATA, savings).ok).toBe(true);
  });

  it("asks for the other account's number first when it has none", () => {
    const bare = { ...savings, account_identifiers: [] };
    const data = { ...DATA, accounts: [bare] };
    const draft = withInstitution(newDraft(data, "bank"), "Sample Bank", data);
    expect(
      readDraft({ ...draft, identifier: "050505000034" }, data, null),
    ).toEqual({
      ok: false,
      problem:
        "Add Sample Bank Savings's number first: each account at Sample Bank needs its number.",
    });
  });

  it("refuses a number a statement can't print", () => {
    const card = { ...other("card"), parentId: 4 };
    expect(
      readDraft({ ...card, identifier: "0505 05AB CDEF 0505" }, DATA, null),
    ).toEqual({
      ok: false,
      problem:
        "That isn't a card number as a statement prints it: digits, with the hidden ones as X.",
    });
    expect(
      readDraft({ ...card, identifier: "xxxx xxxx xxxx 0505" }, DATA, null),
    ).toMatchObject({
      ok: true,
      change: { identifier: "xxxx xxxx xxxx 0505" },
    });
    expect(
      readDraft({ ...other(), identifier: "0505-05X" }, DATA, null),
    ).toEqual({ ok: false, problem: "An account number is digits only." });
  });

  it("uses an account already in the books", () => {
    const draft = { ...other(), source: "existing" as const };
    expect(readDraft(draft, DATA, null)).toEqual({
      ok: false,
      problem: "Pick the account in your books.",
    });
    expect(readDraft({ ...draft, existingId: 7 }, DATA, null)).toMatchObject({
      ok: true,
      change: { ledger: { source: "existing", account_id: 7 } },
    });
  });

  it("edits an existing row", () => {
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
});
