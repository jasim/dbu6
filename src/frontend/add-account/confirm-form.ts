import type {
  AccountKind,
  AddAccountCandidate,
  AddAccountFields,
  StatementAccounts,
} from "../../shared/index";
import {
  formLayout,
  knownInstitution,
  newDraft,
  withInstitution,
  type StatementAccountDraft,
} from "../setup/statement-account-form";
import type { Opening } from "./state";

/*
 * Card 4's form: the banks-and-cards form's name, group and chart account
 * (statement-account-form.ts), with the bank only when dbu6 hasn't met it
 * and no number, which the statements supply. It says only what the fields
 * in view lack; everything else is the server's to refuse, in its words.
 */

/**
 * The form as Confirm opens it: the bank as the read names it, matched to
 * one the books know; the name that follows from it; the usual parent.
 */
export function confirmDraft(
  account: AddAccountCandidate,
  kind: AccountKind,
  data: StatementAccounts,
): StatementAccountDraft {
  const institution = account.institution_listed
    ? account.institution
    : knownInstitution(
        data.institutions.map((one) => one.name),
        account.institution,
      );
  return withInstitution(newDraft(data, kind), institution, data);
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
  draft: StatementAccountDraft,
  data: StatementAccounts,
): ConfirmLayout {
  const { parentInView, canUseExisting } = formLayout(draft, data, null);
  return {
    bank: !account.institution_listed,
    groupInView: parentInView,
    canUseExisting,
  };
}

export type ConfirmReading =
  { ok: true; fields: AddAccountFields } | { ok: false; problem: string };

/** The fields `add` takes, or the first field in view left empty. */
export function readConfirm(
  account: AddAccountCandidate,
  kind: AccountKind,
  opening: Opening,
  draft: StatementAccountDraft,
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
  if (draft.source === "existing" && draft.existingId !== null) {
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
