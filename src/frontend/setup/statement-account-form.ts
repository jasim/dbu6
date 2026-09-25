import {
  canonicalStatementIdentifier,
  type AccountKind,
  type StatementAccountChange,
  type StatementAccountRow,
  type StatementAccounts,
} from "../../shared/index";

/*
 * The add-or-edit form for one bank or card, as values the user is typing,
 * and turning them into the one change the server takes. What the server
 * would refuse and the form can see is said before sending: a missing field,
 * a number a statement can't print, and a second account at an institution
 * with no number to tell the two apart.
 */

export interface StatementAccountDraft {
  kind: AccountKind;
  // A new ledger account, or one already in the books that no preset lists.
  source: "new" | "existing";
  institution: string;
  name: string;
  existingId: number | null;
  identifier: string;
  parentId: number | null;
}

/** The form for a new bank or card. */
export function newDraft(data: StatementAccounts): StatementAccountDraft {
  return {
    kind: "bank",
    source: "new",
    institution: "",
    name: "",
    existingId: null,
    identifier: "",
    parentId: data.default_parents.bank,
  };
}

/** The form for changing `row`: its number is the first it has. */
export function draftOf(row: StatementAccountRow): StatementAccountDraft {
  return {
    kind: row.kind,
    source: "new",
    institution: row.institution,
    name: row.name,
    existingId: null,
    identifier: row.account_identifiers[0] ?? "",
    parentId: row.parent?.id ?? null,
  };
}

/**
 * The draft after switching to `kind`: a parent of the other type no longer
 * fits, so it becomes that kind's default, as does an existing account.
 */
export function withKind(
  draft: StatementAccountDraft,
  kind: AccountKind,
  data: StatementAccounts,
): StatementAccountDraft {
  if (kind === draft.kind) return draft;
  const fits = data.parents[kind].some((one) => one.id === draft.parentId);
  return {
    ...draft,
    kind,
    parentId: fits ? draft.parentId : data.default_parents[kind],
    existingId: null,
  };
}

/** What the number field says under it, for a kind. */
export function identifierHint(kind: AccountKind): string {
  return kind === "card"
    ? "The card number as your statement prints it, with the hidden digits as X, such as 050505XXXXXX0505."
    : "The full account number as your statement prints it, digits only.";
}

/**
 * Another account at the institution, which makes a number necessary for
 * this one; null when there is none. `self` is the account being changed.
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
    return { ok: false, problem: "Name the bank or card company." };
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
  if (typed === "" && other !== null) {
    return {
      ok: false,
      problem: `${institution} already has ${other.name}, so each of its accounts needs its number to tell their statements apart.`,
    };
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
