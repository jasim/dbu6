import {
  canonicalStatementIdentifier,
  type AccountKind,
  type StatementAccountChange,
  type StatementAccountRow,
  type StatementAccounts,
} from "../../shared/index";

/*
 * The add-or-edit form for one bank or card, as values the user is typing,
 * which fields it shows, and turning it into the one change the server
 * takes. The kind comes from the button that opened the form. What the
 * server would refuse and the form can see is said before sending: a
 * missing field, a number a statement can't print, and a second account at
 * a bank with no number to tell the two apart.
 */

export interface StatementAccountDraft {
  kind: AccountKind;
  // A new ledger account, or one already in the books that no bank or card
  // uses yet.
  source: "new" | "existing";
  // The bank, or the card issuer.
  institution: string;
  name: string;
  // Once the user types a name, a change of bank no longer renames it.
  nameEdited: boolean;
  existingId: number | null;
  identifier: string;
  parentId: number | null;
}

/** The form for a new bank account or card. */
export function newDraft(
  data: StatementAccounts,
  kind: AccountKind,
): StatementAccountDraft {
  return {
    kind,
    source: "new",
    institution: "",
    name: "",
    nameEdited: false,
    existingId: null,
    identifier: "",
    parentId: data.default_parents[kind],
  };
}

/** The form for editing `row`: its number is the first it has. */
export function draftOf(row: StatementAccountRow): StatementAccountDraft {
  return {
    kind: row.kind,
    source: "new",
    institution: row.institution,
    name: row.name,
    nameEdited: true,
    existingId: null,
    identifier: row.account_identifiers[0] ?? "",
    parentId: row.parent?.id ?? null,
  };
}

/**
 * The name a new account gets from its bank: "Sample Bank Savings",
 * "Sample Issuer Credit Card", with " 2", " 3"… when the books already have
 * that name. Empty with no bank.
 */
export function suggestedName(
  kind: AccountKind,
  institution: string,
  data: StatementAccounts,
): string {
  const bank = institution.trim();
  if (bank === "") return "";
  const base = `${bank} ${kind === "card" ? "Credit Card" : "Savings"}`;
  const taken = new Set([
    ...data.accounts.map((row) => row.name),
    ...data.parents.bank.map((one) => one.name),
    ...data.parents.card.map((one) => one.name),
    ...data.unlisted.map((one) => one.name),
  ]);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

/** The draft with another bank; an unedited name follows it. */
export function withInstitution(
  draft: StatementAccountDraft,
  institution: string,
  data: StatementAccounts,
): StatementAccountDraft {
  return {
    ...draft,
    institution,
    name: draft.nameEdited
      ? draft.name
      : suggestedName(draft.kind, institution, data),
  };
}

/** The draft with a name the user typed. */
export function withName(
  draft: StatementAccountDraft,
  name: string,
): StatementAccountDraft {
  return { ...draft, name, nameEdited: true };
}

/**
 * Another account at the bank, which makes a number necessary for this one;
 * null when there is none. `self` is the account being edited.
 */
export function otherAccountAt(
  data: StatementAccounts,
  institution: string,
  self: number | null,
): StatementAccountRow | null {
  return (
    data.accounts.find(
      (row) =>
        row.institution === institution.trim() && row.account_id !== self,
    ) ?? null
  );
}

/** Where each field sits: in view, or under "More options". */
export interface FormLayout {
  /**
   * The other account at the bank. With one, the number is required and in
   * view; without, it is optional and under More options.
   */
  other: StatementAccountRow | null;
  /** "Under" is in view when there's no parent to start from. */
  parentInView: boolean;
  /** The switch to use an account already in the books, for a new row. */
  canUseExisting: boolean;
}

export function formLayout(
  draft: StatementAccountDraft,
  data: StatementAccounts,
  editing: StatementAccountRow | null,
): FormLayout {
  return {
    other: otherAccountAt(data, draft.institution, editing?.account_id ?? null),
    parentInView:
      editing === null
        ? data.default_parents[draft.kind] === null
        : editing.parent === null,
    canUseExisting: editing === null && unlistedOf(data, draft.kind).length > 0,
  };
}

/** The accounts of `kind`'s type that no bank or card uses yet. */
export function unlistedOf(data: StatementAccounts, kind: AccountKind) {
  return data.unlisted.filter((one) => one.kind === kind);
}

/** The number field's label and its caption. */
export function numberField(
  kind: AccountKind,
  layout: FormLayout,
  institution: string,
): { label: string; caption: string } {
  const label = kind === "card" ? "Card number" : "Account number";
  if (layout.other === null) {
    return { label, caption: "Optional. Read from the first statement." };
  }
  return {
    label,
    caption:
      kind === "card"
        ? "As printed on the statement, e.g. XXXX XXXX XXXX 0505."
        : `${institution.trim()} already has ${layout.other.name}. This tells their statements apart.`,
  };
}

export type ReadForm =
  { ok: true; change: StatementAccountChange } | { ok: false; problem: string };

/** The change the draft asks for, or the first thing to fix. */
export function readDraft(
  draft: StatementAccountDraft,
  data: StatementAccounts,
  editing: StatementAccountRow | null,
): ReadForm {
  const institution = draft.institution.trim();
  if (institution === "") {
    return {
      ok: false,
      problem:
        draft.kind === "card" ? "Name the card issuer." : "Name the bank.",
    };
  }
  const typed = draft.identifier.trim();
  if (typed !== "" && !canonicalStatementIdentifier(draft.kind, typed)) {
    return {
      ok: false,
      problem:
        draft.kind === "card"
          ? "That isn't a card number as a statement prints it: digits, with the hidden ones as X."
          : "An account number is digits only.",
    };
  }
  const other = otherAccountAt(data, institution, editing?.account_id ?? null);
  if (other !== null) {
    if (typed === "") {
      return {
        ok: false,
        problem: `${institution} already has ${other.name}, so each needs its number.`,
      };
    }
    const bare = data.accounts.find(
      (row) =>
        row.institution === institution &&
        row.account_id !== editing?.account_id &&
        row.account_identifiers.length === 0,
    );
    if (bare !== undefined) {
      return {
        ok: false,
        problem: `Add ${bare.name}'s number first: each account at ${institution} needs its number.`,
      };
    }
  }
  const identifier = typed === "" ? null : typed;

  if (editing === null && draft.source === "existing") {
    if (draft.existingId === null) {
      return { ok: false, problem: "Pick the account in your books." };
    }
    return {
      ok: true,
      change: {
        action: "create",
        kind: draft.kind,
        institution,
        identifier,
        ledger: { source: "existing", account_id: draft.existingId },
      },
    };
  }

  const name = draft.name.trim();
  if (name === "") {
    return { ok: false, problem: "Give the account a name." };
  }
  if (draft.parentId === null) {
    return { ok: false, problem: "Pick where it sits in your chart." };
  }
  if (editing !== null) {
    return {
      ok: true,
      change: {
        action: "update",
        account_id: editing.account_id,
        kind: draft.kind,
        institution,
        name,
        identifier,
        parent_id: draft.parentId,
      },
    };
  }
  return {
    ok: true,
    change: {
      action: "create",
      kind: draft.kind,
      institution,
      identifier,
      ledger: { source: "new", name, parent_id: draft.parentId },
    },
  };
}
