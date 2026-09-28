// The package's `.` entry does not carry `fieldIssuesForSubmissionError`:
// its `export * from './form'` meets the build's `form.js` stub, which has no
// declarations beside it. The package publishes this subpath for it.
import { fieldIssuesForSubmissionError } from "@sapporta/frontend/form";
import type { Row } from "@sapporta/shared/contracts";
import {
  LEDGER_ACCOUNT_TYPES,
  OPENING_BALANCES_NAME,
  type ChartChoice,
  type LedgerAccountType,
} from "../../../shared/index";
import { ACCOUNT_TYPE_TERMS } from "../../account-type-terms";

/*
 * The Accounts page's edit form as values the user is typing: what it can
 * work out from the chart and the import presets alone, and what it sends.
 *
 * Two facts only the server has stay there, and come back as a refusal: an
 * account's posted entries and its drafts. Everything the form can see it
 * says before sending — a name that is taken, a parent that doesn't fit, a
 * type that follows a statement, and what is under an account.
 */

/** One account, as the chart query reads it. */
export interface AccountRow {
  id: number;
  name: string;
  parent_id: number | null;
  account_type: LedgerAccountType;
}

export interface AccountDraft {
  name: string;
  account_type: LedgerAccountType;
  parent_id: number | null;
}

/** What the form knows besides the draft: the chart and the statements. */
export interface AccountFormContext {
  chart: readonly AccountRow[];
  /**
   * The account ids an import preset lists, as a bank account or a card.
   * Its type follows the preset's `is_credit_card`.
   */
  statementAccounts: ReadonlySet<number>;
}

/** A field of the form, which a refusal can be about. */
export type AccountFormField = "name" | "account_type" | "parent_id";

export const ACCOUNT_FORM_FIELDS: readonly AccountFormField[] = [
  "name",
  "account_type",
  "parent_id",
];

/** A new account, under nothing, as the dialog opens for one. */
export const NEW_ACCOUNT_DRAFT: AccountDraft = {
  name: "",
  account_type: "Asset",
  parent_id: null,
};

/** The draft for `account`, as the dialog opens for it. */
export function draftOf(account: AccountRow): AccountDraft {
  return {
    name: account.name,
    account_type: account.account_type,
    parent_id: account.parent_id,
  };
}

/** The account and every account under it, by id. */
export function accountBranch(
  chart: readonly AccountRow[],
  id: number,
): Set<number> {
  const parentOf = new Map(chart.map((one) => [one.id, one.parent_id]));
  const branch = new Set<number>();
  for (const account of chart) {
    const walked = new Set<number>();
    for (
      let at: number | null = account.id;
      at !== null;
      at = parentOf.get(at) ?? null
    ) {
      if (walked.has(at)) break;
      walked.add(at);
      if (at === id) {
        branch.add(account.id);
        break;
      }
    }
  }
  return branch;
}

/**
 * The accounts a parent may be for an account of `account_type` sitting in
 * `self`'s place: that type, less the account itself and anything under it.
 * Ordered by name, as the chart is.
 */
export function parentChoices(
  chart: readonly AccountRow[],
  accountType: LedgerAccountType,
  self: number | null,
): ChartChoice[] {
  const branch = self === null ? new Set<number>() : accountBranch(chart, self);
  return chart
    .filter(
      (account) =>
        account.account_type === accountType && !branch.has(account.id),
    )
    .map((account) => ({
      id: account.id,
      name: account.name,
      path: accountPath(chart, account),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The account's path down the tree, as `Assets:Bank Accounts:Savings`. */
export function accountPath(
  chart: readonly AccountRow[],
  account: AccountRow,
): string {
  const byId = new Map(chart.map((one) => [one.id, one]));
  const names = [account.name];
  const walked = new Set<number>([account.id]);
  for (
    let at = account.parent_id;
    at !== null && !walked.has(at);
    at = byId.get(at)?.parent_id ?? null
  ) {
    walked.add(at);
    const parent = byId.get(at);
    if (parent === undefined) break;
    names.unshift(parent.name);
  }
  return names.join(":");
}

/** Whether `id` is a bank or card account, or holds one. */
export function holdsStatementAccount(
  context: AccountFormContext,
  id: number,
): boolean {
  return [...accountBranch(context.chart, id)].some((one) =>
    context.statementAccounts.has(one),
  );
}

export type TypeLock =
  | { locked: false }
  | {
      locked: true;
      reason: "bank_or_card" | "holds_bank_or_card" | "opening_balances";
    };

/**
 * Whether the type field is fixed for this account: a bank's or card's type
 * comes from the statements imported into it, a group holding one takes
 * theirs, and Opening Balances stays Equity.
 */
export function typeLock(
  account: AccountRow,
  context: AccountFormContext,
): TypeLock {
  if (account.name === OPENING_BALANCES_NAME) {
    return { locked: true, reason: "opening_balances" };
  }
  if (context.statementAccounts.has(account.id)) {
    return { locked: true, reason: "bank_or_card" };
  }
  if (holdsStatementAccount(context, account.id)) {
    return { locked: true, reason: "holds_bank_or_card" };
  }
  return { locked: false };
}

/** Whether the name field is fixed: Opening Balances is found by its name. */
export function nameLocked(account: AccountRow): boolean {
  return account.name === OPENING_BALANCES_NAME;
}

/**
 * The draft after choosing `accountType`: a parent of the old type no longer
 * fits the account, so it is cleared.
 */
export function withType(
  draft: AccountDraft,
  accountType: LedgerAccountType,
  chart: readonly AccountRow[],
  self: number | null,
): AccountDraft {
  if (draft.parent_id === null || draft.account_type === accountType) {
    return { ...draft, account_type: accountType };
  }
  const fits = parentChoices(chart, accountType, self).some(
    (choice) => choice.id === draft.parent_id,
  );
  return {
    ...draft,
    account_type: accountType,
    parent_id: fits ? draft.parent_id : null,
  };
}

/**
 * What retyping the account does, in one line: the sub-accounts that move
 * with it, and where it will show. Null while the type is unchanged, and
 * while nothing would move and nothing is posted.
 */
export function moveNotice(args: {
  account: AccountRow;
  chart: readonly AccountRow[];
  account_type: LedgerAccountType;
  hasEntries: boolean;
}): string | null {
  const { account, chart, account_type, hasEntries } = args;
  if (account_type === account.account_type) return null;
  const moved = accountBranch(chart, account.id).size - 1;
  if (moved === 0 && !hasEntries) return null;
  const term = ACCOUNT_TYPE_TERMS[account_type].term;
  const lines: string[] = [];
  if (moved > 0) {
    lines.push(
      `Its ${moved} sub-account${moved === 1 ? "" : "s"} ${moved === 1 ? "moves" : "move"} to ${term} with it.`,
    );
  }
  lines.push(
    moved > 0
      ? `They'll show under ${term} in reports.`
      : `It'll show under ${term} in reports.`,
  );
  return lines.join(" ");
}

/**
 * What the form already knows is standing on the account, so a delete never
 * gets as far as the confirmation. An entry or a draft is the server's to
 * say.
 */
export function deleteBlockers(
  account: AccountRow,
  context: AccountFormContext,
): string[] {
  const blockers: string[] = [];
  const children = context.chart.filter(
    (one) => one.parent_id === account.id,
  ).length;
  if (children > 0) {
    blockers.push(
      `${account.name} has ${children} sub-account${children === 1 ? "" : "s"} under it; delete ${children === 1 ? "it" : "them"} first.`,
    );
  }
  if (holdsStatementAccount(context, account.id)) {
    blockers.push(
      `${account.name} is a bank or card. Remove it in Settings › Banks & cards.`,
    );
  }
  return blockers;
}

export type ReadAccountForm =
  | { ok: true; draft: AccountDraft }
  | { ok: false; problem: string; field: AccountFormField };

/**
 * The change the form asks for, or the first thing to fix. `account` is null
 * for a new account.
 */
export function readDraft(
  draft: AccountDraft,
  account: AccountRow | null,
  context: AccountFormContext,
): ReadAccountForm {
  const name = draft.name.trim();
  if (name === "") {
    return { ok: false, problem: "Give the account a name.", field: "name" };
  }
  if (
    account !== null &&
    nameLocked(account) &&
    name !== OPENING_BALANCES_NAME
  ) {
    return {
      ok: false,
      problem: `${OPENING_BALANCES_NAME} keeps its name.`,
      field: "name",
    };
  }
  const taken = context.chart.some(
    (one) => one.name === name && one.id !== (account?.id ?? null),
  );
  if (taken) {
    return {
      ok: false,
      problem: `Your books already have an account named ${name}.`,
      field: "name",
    };
  }
  const fits = parentChoices(
    context.chart,
    draft.account_type,
    account?.id ?? null,
  ).some((choice) => choice.id === draft.parent_id);
  if (draft.parent_id !== null && !fits) {
    return {
      ok: false,
      problem: `A parent has to be ${withArticle(draft.account_type)} account of its own, outside ${name}'s sub-accounts.`,
      field: "parent_id",
    };
  }
  return { ok: true, draft: { ...draft, name } };
}

/**
 * The field a server refusal is about. The 422 body names it in `field`; a
 * body that carries Sapporta's `details` instead is read the same way.
 */
export function refusalField(error: unknown): AccountFormField | null {
  const body =
    error && typeof error === "object" && "body" in error ? error.body : null;
  const field =
    body && typeof body === "object" && "field" in body ? body.field : null;
  if (isFormField(field)) return field;
  for (const issue of fieldIssuesForSubmissionError(error)) {
    if (isFormField(issue.field)) return issue.field;
  }
  return null;
}

function isFormField(value: unknown): value is AccountFormField {
  return (
    typeof value === "string" &&
    (ACCOUNT_FORM_FIELDS as readonly string[]).includes(value)
  );
}

function withArticle(type: LedgerAccountType): string {
  return type === "Asset" || type === "Expense" ? `an ${type}` : `a ${type}`;
}

/**
 * A row from the accounts table as the form reads one, or null when it lacks
 * a column. Both ways in — the chart's page of rows and the one row an edit
 * URL names — land here, so the form is handed the same four columns either
 * way.
 */
export function accountRow(row: Row): AccountRow | null {
  const { id, name, parent_id, account_type } = row;
  if (
    typeof id !== "number" ||
    typeof name !== "string" ||
    typeof account_type !== "string" ||
    !(LEDGER_ACCOUNT_TYPES as readonly string[]).includes(account_type) ||
    (parent_id !== null && typeof parent_id !== "number")
  ) {
    return null;
  }
  return {
    id,
    name,
    parent_id: parent_id === null ? null : parent_id,
    account_type: account_type as LedgerAccountType,
  };
}
