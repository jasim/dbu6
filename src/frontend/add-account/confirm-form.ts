import type {
  AccountKind,
  AddAccountCandidate,
  AddAccountFields,
  StatementAccounts,
} from "../../shared/index";
import type { Opening } from "./state";

/*
 * Card 4's form, for a new account: its name, following the bank until the
 * user types one; its group; or an account from the chart instead; and the
 * bank itself only when no bank the books know lists the parser. No number:
 * the statements supply it. The form says only what the fields in view
 * lack; everything else is the server's to refuse, in its words.
 */

export interface ConfirmDraft {
  kind: AccountKind;
  /** The bank, or the card issuer. */
  institution: string;
  name: string;
  /** Once the user types a name, a change of bank no longer renames it. */
  nameEdited: boolean;
  /** An account from the chart to use instead of a new one. */
  existingId: number | null;
  parentId: number | null;
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
 * The form as Confirm opens it: the bank as the read names it (the server
 * has matched it to one the books know), the name that follows from it,
 * and the usual group.
 */
export function confirmDraft(
  account: AddAccountCandidate,
  kind: AccountKind,
  data: StatementAccounts,
): ConfirmDraft {
  return withInstitution(
    {
      kind,
      institution: "",
      name: "",
      nameEdited: false,
      existingId: null,
      parentId: data.default_parents[kind],
    },
    account.institution,
    data,
  );
}

/** The draft with another bank; an unedited name follows it. */
export function withInstitution(
  draft: ConfirmDraft,
  institution: string,
  data: StatementAccounts,
): ConfirmDraft {
  return {
    ...draft,
    institution,
    name: draft.nameEdited
      ? draft.name
      : suggestedName(draft.kind, institution, data),
  };
}

/** The draft with a name the user typed. */
export function withName(draft: ConfirmDraft, name: string): ConfirmDraft {
  return { ...draft, name, nameEdited: true };
}

/** The accounts of `kind`'s type in the chart that no bank or card uses. */
export function unlistedOf(data: StatementAccounts, kind: AccountKind) {
  return data.unlisted.filter((one) => one.kind === kind);
}

/** Which of Confirm's fields are in view. */
export interface ConfirmLayout {
  /** The bank: only when no bank the books know lists the parser. */
  bank: boolean;
  /**
   * The group: in view when there's no usual one to start from (the first
   * bank or card), or the kind's sit under several; else under More options.
   */
  groupInView: boolean;
  /** An account in the chart of the kind's type that no bank or card uses. */
  canUseExisting: boolean;
}

export function confirmLayout(
  account: AddAccountCandidate,
  kind: AccountKind,
  data: StatementAccounts,
): ConfirmLayout {
  return {
    bank: !account.institution_listed,
    groupInView:
      data.default_parents[kind] === null || data.mixed_parents[kind],
    canUseExisting: unlistedOf(data, kind).length > 0,
  };
}

export type ConfirmReading =
  { ok: true; fields: AddAccountFields } | { ok: false; problem: string };

/** The fields `add` takes, or the first field in view left empty. */
export function readConfirm(
  account: AddAccountCandidate,
  kind: AccountKind,
  opening: Opening,
  draft: ConfirmDraft,
  data: StatementAccounts,
): ConfirmReading {
  const fields: AddAccountFields = {};
  if (account.kind === null) fields.kind = kind;
  if (opening.from === "typed") fields.opening_amount = opening.amount;
  // A bank or card already set up takes its files as it is.
  if (account.account !== null) return { ok: true, fields };

  if (!account.institution_listed) {
    const institution = draft.institution.trim();
    if (institution === "") {
      return {
        ok: false,
        problem: kind === "card" ? "Name the card issuer." : "Name the bank.",
      };
    }
    fields.institution = institution;
  }
  if (draft.existingId !== null) {
    return { ok: true, fields: { ...fields, account_id: draft.existingId } };
  }
  const name = draft.name.trim();
  if (name === "") return { ok: false, problem: "Give the account a name." };
  fields.name = name;
  if (draft.parentId !== null) {
    fields.parent_id = draft.parentId;
  } else if (data.default_parents[kind] === null) {
    return { ok: false, problem: "Pick a group." };
  }
  return { ok: true, fields };
}
