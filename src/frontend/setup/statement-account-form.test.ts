import { describe, expect, it } from "vitest";
import type {
  StatementAccountRow,
  StatementAccounts,
} from "../../shared/index";
import {
  draftOf,
  newDraft,
  readDraft,
  withKind,
} from "./statement-account-form";

const savings: StatementAccountRow = {
  account_id: 8,
  name: "Sample Savings",
  kind: "bank",
  institution: "Sample Bank",
  account_identifiers: [],
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

describe("the bank or card form", () => {
  it("creates a new account under the kind's default parent", () => {
    const draft = {
      ...newDraft(DATA),
      institution: " Other Bank ",
      name: "Other Savings",
    };
    expect(readDraft(draft, DATA, null)).toEqual({
      ok: true,
      change: {
        action: "create",
        kind: "bank",
        institution: "Other Bank",
        identifier: null,
        ledger: { source: "new", name: "Other Savings", parent_id: 2 },
      },
    });
  });

  it("asks for a number at an institution that has another account", () => {
    const draft = {
      ...newDraft(DATA),
      institution: "Sample Bank",
      name: "Sample Current",
    };
    expect(readDraft(draft, DATA, null)).toEqual({
      ok: false,
      problem:
        "Sample Bank already has Sample Savings, so each of its accounts needs its number to tell their statements apart.",
    });
    // The account being changed doesn't count against itself.
    expect(readDraft(draftOf(savings), DATA, savings).ok).toBe(true);
  });

  it("refuses a number a statement can't print", () => {
    const card = withKind(
      { ...newDraft(DATA), institution: "Sample Cards", name: "Sample Card" },
      "card",
      DATA,
    );
    expect(
      readDraft({ ...card, identifier: "0505 05AB CDEF 0505" }, DATA, null),
    ).toEqual({
      ok: false,
      problem:
        "That isn't a card number as a statement prints it: digits, with the hidden ones as X.",
    });
    expect(
      readDraft(
        { ...card, identifier: "0505 05xx xxxx 0505", parentId: 4 },
        DATA,
        null,
      ),
    ).toMatchObject({
      ok: true,
      change: { identifier: "0505 05xx xxxx 0505" },
    });
  });

  it("drops a parent of the other type when the kind changes", () => {
    const card = withKind(newDraft(DATA), "card", DATA);
    expect(card.parentId).toBeNull();
    expect(
      readDraft(
        { ...card, institution: "Sample Cards", name: "Card" },
        DATA,
        null,
      ),
    ).toEqual({ ok: false, problem: "Pick where it sits in your chart." });
  });

  it("links an account already in the books", () => {
    const draft = {
      ...newDraft(DATA),
      source: "existing" as const,
      institution: "Cash Book",
      existingId: 7,
    };
    expect(readDraft(draft, DATA, null)).toMatchObject({
      ok: true,
      change: { ledger: { source: "existing", account_id: 7 } },
    });
  });

  it("changes an existing row", () => {
    expect(
      readDraft(
        { ...draftOf(savings), name: "Renamed", identifier: "050505000012" },
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
        identifier: "050505000012",
        parent_id: 2,
      },
    });
  });
});
