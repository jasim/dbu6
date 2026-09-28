import type {
  AccountChange,
  AccountChangeField,
  AccountChangeRefusalCode,
  AccountDeleteRefusalCode,
  ChartAccount,
  ChartOfAccounts,
  ChartProposal,
} from "../../shared/index.js";
import { OPENING_BALANCES_NAME } from "../../shared/index.js";
import {
  accountBranchIds,
  deleteAccount,
  findOpeningBalancesAccount,
  insertChartAccounts,
  isAccountNameFree,
  isSuitableAccountParent,
  loadAccountChart,
  loadLedgerAccounts,
  placeAccount,
  type ChartedAccount,
} from "../modules/accounts/index.js";
import {
  chartRequest,
  normalizeChartProposal,
  STARTER_CHART,
  STARTER_UNTICKED,
  validateChartProposal,
  type ChartLlm,
} from "../modules/chart-of-accounts/index.js";
import { countDraftsByAccount } from "../modules/drafts/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { countEntriesByAccount } from "../modules/journals/index.js";
import type { Ledger, LedgerAuth } from "../modules/ledger-sql/index.js";

/*
 * The chart of accounts, the first thing setup asks for (/setup). Books
 * with no accounts at all start from a proposal the user ticks through;
 * creating it inserts the ticked accounts, parents first, in one
 * transaction. Books with any account, even one made by hand, show their
 * own chart, and one account at a time is changed on the Accounts page:
 *
 *   changeAccount        a name, type and parent written together, the
 *                        whole branch moving when the type changes
 *   deleteChartAccount   an account with nothing on it and nothing under it
 *
 * Both do their checks in the transaction they write in, so a refusal
 * writes nothing. The rules the tree triggers can't see live here: Opening
 * Balances keeps its name and stays Equity, a bank's or card's type follows
 * its import preset, and what a delete is standing on is named.
 *
 * The user can also describe how money moves for them and have the LLM
 * revise the proposal on screen (`suggestChart`), in as many rounds as they
 * like. That call reads and writes nothing; its answer is only a proposal.
 */

/**
 * Whether the books have a chart: any account at all, even one made by hand.
 * Without one, setup starts from the starter chart and Home asks for it.
 */
export function hasChart(ledger: Pick<Ledger, "sqlite" | "auth">): boolean {
  return chartIn(loadLedgerAccounts(ledger.sqlite, ledger.auth));
}

// The rule itself, over the books' accounts as a caller has them.
function chartIn(accounts: readonly { id: number }[]): boolean {
  return accounts.length > 0;
}

/** The starter chart for books with no accounts, or the books' own chart. */
export function loadChartOfAccounts(ledger: Ledger): ChartOfAccounts {
  const accounts = loadAccountChart(ledger.db, ledger.auth);
  if (!chartIn(accounts)) {
    return {
      state: "new",
      starter: { accounts: [...STARTER_CHART] },
      unticked: [...STARTER_UNTICKED],
    };
  }
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return {
    state: "existing",
    chart: {
      accounts: accounts.map((account) => ({
        name: account.name,
        account_type: account.account_type,
        parent:
          account.parent_id === null
            ? null
            : (names.get(account.parent_id) ?? null),
        note: null,
      })),
    },
  };
}

export type ChartCreation =
  | { ok: true; created: number }
  | {
      ok: false;
      code: "books_have_accounts" | "invalid_chart";
      problems: string[];
    };

/** Creates the chart in books with no accounts, or says why it can't. */
export function createChart(
  ledger: Ledger,
  accounts: readonly ChartAccount[],
): ChartCreation {
  const valid = validateChartProposal(accounts);
  if (!valid.ok) {
    return { ok: false, code: "invalid_chart", problems: valid.problems };
  }
  return ledger.db.transaction((tx: any): ChartCreation => {
    // Read inside the transaction it writes in.
    if (chartIn(loadAccountChart(tx, ledger.auth))) {
      return {
        ok: false,
        code: "books_have_accounts",
        problems: [
          "Your books already have accounts; change them on the Accounts page.",
        ],
      };
    }
    const created = insertChartAccounts(tx, ledger.auth, valid.accounts);
    return { ok: true, created: created.length };
  });
}

export type ChartSuggestion =
  | { ok: true; proposal: ChartProposal; notes: string[] }
  | { ok: false; code: "llm_unavailable" | "llm_failed"; error: string };

/**
 * The LLM's revision of `current` to fit `description`, fixed where that
 * needs no guess, with a note for each fix. One call, never retried.
 */
export async function suggestChart(
  llm: ChartLlm,
  description: string,
  current: readonly ChartAccount[],
): Promise<ChartSuggestion> {
  if (!llm.caller.ready) {
    return { ok: false, code: "llm_unavailable", error: llm.caller.reason };
  }
  const answer = await llm.caller.client.get(
    chartRequest(description, current),
  );
  if (!answer.ok) {
    return {
      ok: false,
      code: "llm_failed",
      error: `${llm.name} couldn't propose accounts: ${answer.error}`,
    };
  }
  const normalized = normalizeChartProposal(answer.value.accounts);
  return {
    ok: true,
    proposal: { accounts: normalized.accounts },
    notes: normalized.notes,
  };
}

// --- One account at a time ---------------------------------------------

export type ChangeAccountProblem = {
  code: AccountChangeRefusalCode;
  field: AccountChangeField;
  message: string;
};

export type ChangeAccountOutcome =
  | { ok: true; account: ChartedAccount; moved: number }
  | { ok: false; problem: ChangeAccountProblem };

export type DeleteChartAccountProblem = {
  code: AccountDeleteRefusalCode;
  message: string;
};

export type DeleteChartAccountOutcome =
  { ok: true } | { ok: false; problem: DeleteChartAccountProblem };

// Thrown inside the transaction, so nothing a refused change wrote stands
// (as `StatementAccountRefused` does in workflows/import-presets.ts).
class ChangeAccountRefused extends Error {
  constructor(readonly problem: ChangeAccountProblem) {
    super(problem.message);
  }
}

class DeleteChartAccountRefused extends Error {
  constructor(readonly problem: DeleteChartAccountProblem) {
    super(problem.message);
  }
}

function refuse(
  code: AccountChangeRefusalCode,
  field: AccountChangeField,
  message: string,
): never {
  throw new ChangeAccountRefused({ code, field, message });
}

function refuseDelete(code: AccountDeleteRefusalCode, message: string): never {
  throw new DeleteChartAccountRefused({ code, message });
}

/**
 * Renames, retypes and moves one account, or says why it can't. The name,
 * type and parent are written together, and a type change takes the whole
 * branch with it (`placeAccount`), in one transaction: a refusal writes
 * nothing. Retyping is allowed with entries posted, because every amount
 * carries its own sign and only the reports it lands in change.
 */
export function changeAccount(
  ledger: Ledger,
  id: number,
  change: AccountChange,
): ChangeAccountOutcome {
  try {
    return ledger.db.transaction((tx: any) => {
      const { auth } = ledger;
      const chart = loadAccountChart(tx, auth);
      const account = chart.find((one) => one.id === id);
      if (account === undefined) {
        refuse(
          "unknown_account",
          null,
          "Your books no longer have that account.",
        );
      }
      const name = change.name.trim();
      if (name === "") {
        refuse("name_required", "name", "Give the account a name.");
      }
      if (!isAccountNameFree(chart, name, id)) {
        refuse(
          "ledger_name_taken",
          "name",
          `Your books already have an account named ${name}.`,
        );
      }
      if (
        !isSuitableAccountParent(
          chart,
          change.parent_id,
          change.account_type,
          id,
        )
      ) {
        refuse(
          "parent_not_suitable",
          "parent_id",
          `A parent has to be ${withArticle(change.account_type)} account.`,
        );
      }

      // Opening entries post against it by name (`OPENING_BALANCES_ACCOUNT`)
      // and it stays Equity; moving it within Equity is fine.
      const opening = findOpeningBalancesAccount(tx, auth);
      if (opening !== null && opening.id === id) {
        if (name !== OPENING_BALANCES_NAME) {
          refuse(
            "opening_balances_fixed",
            "name",
            `${OPENING_BALANCES_NAME} keeps its name.`,
          );
        }
        if (change.account_type !== "Equity") {
          refuse(
            "opening_balances_fixed",
            "account_type",
            `${OPENING_BALANCES_NAME} stays an Equity account.`,
          );
        }
      }

      // A bank or card's type follows its import preset's `is_credit_card`.
      // Anything in its branch counts: retyping the group would leave the
      // preset's account and its parent in different types.
      if (change.account_type !== account.account_type) {
        const listed = presetAccountIds(tx, auth);
        const holdsOne = [...accountBranchIds(chart, id)].some((one) =>
          listed.has(one),
        );
        if (holdsOne) {
          refuse(
            "bank_or_card_type_fixed",
            "account_type",
            listed.has(id)
              ? `${account.name} is a bank or card, so its type comes from the statements imported into it. Change it in Settings › Banks & cards.`
              : `${account.name} holds a bank or card, whose statements set its type. Change them in Settings › Banks & cards.`,
          );
        }
      }

      const moved = placeAccount(tx, auth, id, {
        name,
        account_type: change.account_type,
        parent_id: change.parent_id,
      });
      const placed = loadAccountChart(tx, auth).find((one) => one.id === id);
      if (placed === undefined) {
        throw new Error(`Account ${id} went missing as it was placed.`);
      }
      return { ok: true as const, account: placed, moved };
    });
  } catch (error) {
    if (error instanceof ChangeAccountRefused) {
      return { ok: false, problem: error.problem };
    }
    throw error;
  }
}

/**
 * Deletes one account, or says what is standing on it: sub-accounts, a
 * preset that lists it as a bank or card, posted entries, or drafts. One
 * transaction; a refusal writes nothing. A bank or card is removed in
 * Settings › Banks & cards, so its preset goes with it.
 */
export function deleteChartAccount(
  ledger: Ledger,
  id: number,
): DeleteChartAccountOutcome {
  try {
    return ledger.db.transaction((tx: any) => {
      const { auth } = ledger;
      const chart = loadAccountChart(tx, auth);
      const account = chart.find((one) => one.id === id);
      if (account === undefined) {
        refuseDelete(
          "unknown_account",
          "Your books no longer have that account.",
        );
      }
      const children = chart.filter((one) => one.parent_id === id);
      if (children.length > 0) {
        refuseDelete(
          "has_sub_accounts",
          `${account.name} has ${counted(children.length, "sub-account")} under it; delete ${children.length === 1 ? "it" : "them"} first.`,
        );
      }
      // A bank or card is removed in Settings › Banks & cards, where its
      // preset goes with it. Sub-accounts were refused above, so the account
      // itself is what a preset could list.
      if (presetAccountIds(tx, auth).has(id)) {
        refuseDelete(
          "bank_or_card",
          `${account.name} is a bank or card. Remove it in Settings › Banks & cards.`,
        );
      }
      const entries = countEntriesByAccount(ledger.sqlite, auth).get(id) ?? 0;
      if (entries > 0) {
        refuseDelete(
          "has_entries",
          `${account.name} has ${counted(entries, "entry", "entries")} in your books.`,
        );
      }
      const drafts = countDraftsByAccount(ledger.sqlite, auth).get(id) ?? 0;
      if (drafts > 0) {
        refuseDelete(
          "has_drafts",
          `${account.name} has ${counted(drafts, "draft")} to review.`,
        );
      }
      deleteAccount(tx, auth, id);
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof DeleteChartAccountRefused) {
      return { ok: false, problem: error.problem };
    }
    throw error;
  }
}

// The ledger accounts the import presets list, as a bank account or a card.
// A preset names its account by id, so this is the only place a bank or card
// is written down.
function presetAccountIds(tx: any, auth: LedgerAuth): Set<number> {
  return new Set(
    loadImportPresets(tx, auth).flatMap((institution) =>
      institution.accounts.map((account) => account.account_id),
    ),
  );
}

// "an Asset account", "a Liability account".
function withArticle(type: AccountChange["account_type"]): string {
  return type === "Asset" || type === "Expense" ? `an ${type}` : `a ${type}`;
}

// "3 sub-accounts", "1 entry".
function counted(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
