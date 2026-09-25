import {
  canonicalStatementIdentifier,
  type AccountKind,
  type StatementAccountChange,
  type StatementAccountRow,
  type StatementAccounts,
} from "../../shared/index";

/*
 * The form for one bank or card, as values the user is typing, and which
 * fields it shows. /add's Confirm card fills it for a new account
 * (add-account/confirm-form.ts); the Banks & cards page edits one that has
 * no transactions yet, and `readDraft` turns that edit into the one change
 * the server takes. What the server would refuse and the form can see is
 * said before sending: a missing field, a number a statement can't print,
 * and a second account at a bank with no number to tell the two apart.
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
 * The name a new account gets from its bank: "Sample Savings" and "Sample
 * Credit Card" at Sample Bank (a trailing "Bank" goes), "Sample Issuer
 * Credit Card", with " 2", " 3"… when the books already have that name.
 * Empty with no bank.
 */
export function suggestedName(
  kind: AccountKind,
  institution: string,
  data: StatementAccounts,
): string {
  const bank = institution.trim();
  if (bank === "") return "";
  const stem = bank.replace(/\s+bank$/i, "");
  const base = `${stem} ${kind === "card" ? "Credit Card" : "Savings"}`;
  // Any account in the books, of any type, and the banks and cards' own
  // names, which a deleted account's row keeps.
  const taken = new Set([
    ...data.account_names,
    ...data.accounts.map((row) => row.name),
  ]);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  return name;
}

/**
 * The bank the books know that `typed` names, ignoring case and extra
 * spaces, else the typed name as it is: "sample  bank" is "Sample Bank",
 * never a second bank.
 */
export function knownInstitution(
  institutions: readonly string[],
  typed: string,
): string {
  const text = typed.trim().replace(/\s+/g, " ");
  const key = text.toLowerCase();
  return (
    institutions.find(
      (name) => name.trim().replace(/\s+/g, " ").toLowerCase() === key,
    ) ?? text
  );
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
  /**
   * "Under" is in view when there's no parent to start from, or the kind's
   * accounts sit under more than one and the default is only a guess.
   */
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
        ? data.default_parents[draft.kind] === null ||
          data.mixed_parents[draft.kind]
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

/** A field of the form, which a problem can be about. */
export type FormField = "institution" | "name" | "identifier" | "parent";

export type ReadForm =
  | { ok: true; change: StatementAccountChange }
  | { ok: false; problem: string; field: FormField };

/**
 * Whether `field` sits under "More options", closed at first, in this
 * layout: the number while it is optional, and Under when there's a parent
 * to start from.
 */
export function underMoreOptions(
  field: FormField,
  layout: FormLayout,
): boolean {
  switch (field) {
    case "identifier":
      return layout.other === null;
    case "parent":
      return !layout.parentInView;
    case "institution":
    case "name":
      return false;
  }
}

/** The field a server refusal of the form is about, when it names one. */
export function refusalField(error: unknown): FormField | null {
  const body =
    error && typeof error === "object" && "body" in error ? error.body : null;
  const code =
    body && typeof body === "object" && "code" in body ? body.code : null;
  switch (code) {
    case "identifier_invalid":
      return "identifier";
    case "parent_not_suitable":
      return "parent";
    case "ledger_name_taken":
      return "name";
    default:
      return null;
  }
}

/** The change an edit of `row` asks for, or the first thing to fix. */
export function readDraft(
  draft: StatementAccountDraft,
  data: StatementAccounts,
  row: StatementAccountRow,
): ReadForm {
  const institution = draft.institution.trim();
  if (institution === "") {
    return {
      ok: false,
      problem:
        draft.kind === "card" ? "Name the card issuer." : "Name the bank.",
      field: "institution",
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
      field: "identifier",
    };
  }
  const other = otherAccountAt(data, institution, row.account_id);
  if (other !== null) {
    if (typed === "") {
      return {
        ok: false,
        problem: `${institution} already has ${other.name}, so each needs its number.`,
        field: "identifier",
      };
    }
    const bare = data.accounts.find(
      (one) =>
        one.institution === institution &&
        one.account_id !== row.account_id &&
        one.account_identifiers.length === 0,
    );
    if (bare !== undefined) {
      return {
        ok: false,
        problem: `Add ${bare.name}'s number first: each account at ${institution} needs its number.`,
        field: "institution",
      };
    }
  }

  const name = draft.name.trim();
  if (name === "") {
    return { ok: false, problem: "Give the account a name.", field: "name" };
  }
  if (draft.parentId === null) {
    return {
      ok: false,
      problem: "Pick the parent account grouping it belongs to.",
      field: "parent",
    };
  }
  return {
    ok: true,
    change: {
      action: "update",
      account_id: row.account_id,
      kind: draft.kind,
      institution,
      name,
      identifier: typed === "" ? null : typed,
      parent_id: draft.parentId,
    },
  };
}
