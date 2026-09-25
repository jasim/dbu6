import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { llmStatusSchema } from "./coding-agent.js";
import { importPresetRefusalCodeSchema } from "./import-presets.js";

const c = initContract();

/*
 * Setting up the books: the chart of accounts (/setup), and the banks and
 * cards statements come from, which /add sets up from their statements and
 * Settings › Banks & cards changes. Nothing here keeps state of its own.
 */

export const LEDGER_ACCOUNT_TYPES = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
] as const;
export const ledgerAccountTypeSchema = z.enum(LEDGER_ACCOUNT_TYPES);
export type LedgerAccountType = z.infer<typeof ledgerAccountTypeSchema>;

/*
 * A chart of accounts as a flat list, each account naming its parent by
 * name: names are unique in a user's books, so the name is the key. Flat
 * rather than nested because a recursive schema converts badly to the JSON
 * schema a structured LLM call needs. The same shape is the starter chart,
 * the LLM's proposal and, restricted to the ticked accounts, what creating a
 * chart takes.
 */
export const chartAccountSchema = z.object({
  name: z.string().min(1),
  account_type: ledgerAccountTypeSchema,
  // The parent's name; null for a type's top account. Same account_type.
  parent: z.string().nullable(),
  // One line on what goes here, shown under the name. Optional for the
  // starter; the LLM fills it so the user can see why an account is proposed.
  note: z.string().nullable(),
});
export type ChartAccount = z.infer<typeof chartAccountSchema>;

export const chartProposalSchema = z.object({
  accounts: z.array(chartAccountSchema),
});
export type ChartProposal = z.infer<typeof chartProposalSchema>;

/** An account in a chart's tree order, with how deep it sits. */
export interface ChartRow {
  account: ChartAccount;
  // 0 for a type's top account.
  depth: number;
}

/**
 * The accounts in tree order: the top accounts by type (in
 * LEDGER_ACCOUNT_TYPES order), each followed by everything under it,
 * siblings in list order. An account no top account reaches, because its
 * parent is not in the list or it is in a loop, is left out. The first of
 * two accounts with one name is the one children sit under.
 */
export function chartInTreeOrder(
  accounts: readonly ChartAccount[],
): ChartRow[] {
  const childrenOf = new Map<string, ChartAccount[]>();
  for (const account of accounts) {
    if (account.parent === null) continue;
    const siblings = childrenOf.get(account.parent) ?? [];
    siblings.push(account);
    childrenOf.set(account.parent, siblings);
  }
  const rows: ChartRow[] = [];
  const seen = new Set<string>();
  const walk = (account: ChartAccount, depth: number) => {
    if (seen.has(account.name)) return;
    seen.add(account.name);
    rows.push({ account, depth });
    for (const child of childrenOf.get(account.name) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const type of LEDGER_ACCOUNT_TYPES) {
    for (const account of accounts) {
      if (account.parent === null && account.account_type === type) {
        walk(account, 0);
      }
    }
  }
  return rows;
}

// The one account a new chart must hold by name: opening entries post
// against it (OPENING_BALANCES_ACCOUNT on the server).
export const OPENING_BALANCES_NAME = "Opening Balances";

// The chart: a new system (no accounts at all) starts from a proposal; one that
// has accounts sees them.
export const chartOfAccountsSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("new"),
    starter: chartProposalSchema,
    // Starter accounts the checklist opens unticked.
    unticked: z.array(z.string()),
  }),
  z.object({ state: z.literal("existing"), chart: chartProposalSchema }),
]);
export type ChartOfAccounts = z.infer<typeof chartOfAccountsSchema>;

export const chartRefusalSchema = z.object({
  error: z.string(),
  code: z.enum([
    // A chart is created only in books with no accounts at all.
    "books_have_accounts",
    // `problems` says which of validateChartProposal's rules it breaks.
    "invalid_chart",
  ]),
  problems: z.array(z.string()),
});
export type ChartRefusal = z.infer<typeof chartRefusalSchema>;

export const chartSuggestionRequestSchema = z.object({
  // How money moves for the user, in their words.
  description: z.string().trim().min(1).max(4000),
  // The chart on screen, which the LLM revises rather than starting over.
  current: z.array(chartAccountSchema),
});

export const chartSuggestionSchema = z.object({
  // Every account of it is proposed; the user ticks through it.
  proposal: chartProposalSchema,
  // What the server fixed in the LLM's answer, one line each.
  notes: z.array(z.string()),
});
export type ChartSuggestion = z.infer<typeof chartSuggestionSchema>;

export const chartSuggestionRefusalSchema = z.object({
  error: z.string(),
  code: z.enum([
    // No coding agent, or none of its models answers (see Settings).
    "llm_unavailable",
    // The call failed or answered with something that isn't a chart.
    "llm_failed",
  ]),
});

// The banks and cards statements come from, each an account in an
// import preset. A row can be changed only while its account has no
// transactions of its own, the rule /add and Home follow: `entries` and
// `drafts` are both 0. Removing one deletes its opening entry when that
// journal opens it alone.
export const statementAccountRowSchema = z.object({
  account_id: z.number().int(),
  // The preset's name for it, which a change keeps equal to the ledger's.
  name: z.string(),
  kind: accountKindSchema,
  institution: z.string(),
  account_identifiers: z.array(z.string()),
  // Where the ledger account sits; null for a top account.
  parent: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  // False when the preset names an account the ledger no longer has.
  in_ledger: z.boolean(),
  // Posted entries of its own, its opening entry and what other accounts'
  // statements put on it left out.
  entries: z.number().int(),
  // Drafts from its own statements.
  drafts: z.number().int(),
});
export type StatementAccountRow = z.infer<typeof statementAccountRowSchema>;

// An account a bank or card can sit under, or be.
const chartChoiceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  // "Assets:Bank Accounts", from the tree.
  path: z.string(),
});
export type ChartChoice = z.infer<typeof chartChoiceSchema>;

export const statementAccountsSchema = z.object({
  institutions: z.array(
    z.object({ name: z.string(), parsers: z.array(z.string()) }),
  ),
  accounts: z.array(statementAccountRowSchema),
  // The accounts of each kind's type, where a new one can sit.
  parents: z.object({
    bank: z.array(chartChoiceSchema),
    card: z.array(chartChoiceSchema),
  }),
  // The parent most preset accounts of the same kind sit under; null with
  // none, when the user picks one. Never inferred from names.
  default_parents: z.object({
    bank: z.number().int().nullable(),
    card: z.number().int().nullable(),
  }),
  // Whether a kind's preset accounts sit under more than one parent, when
  // the default is only a guess and the form shows it.
  mixed_parents: z.object({
    bank: z.boolean(),
    card: z.boolean(),
  }),
  // Asset and Liability accounts no preset lists and no account sits
  // under, which a row can use instead of a new account.
  unlisted: z.array(chartChoiceSchema.extend({ kind: accountKindSchema })),
  // Every account name in the books, of any type: a new one must differ.
  account_names: z.array(z.string()),
});
export type StatementAccounts = z.infer<typeof statementAccountsSchema>;

// A number as the user typed it; the server puts it in canonical form
// (`canonicalStatementIdentifier`). Null or blank for none.
const typedIdentifierSchema = z.string().max(64).nullable();

export const statementAccountChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    kind: accountKindSchema,
    // A preset institution's name, or a new one, which is added.
    institution: z.string().trim().min(1),
    identifier: typedIdentifierSchema,
    ledger: z.discriminatedUnion("source", [
      // A new ledger account of the kind's type under `parent_id`.
      z.object({
        source: z.literal("new"),
        name: z.string().trim().min(1),
        parent_id: z.number().int().positive(),
      }),
      // An Asset or Liability account no preset lists yet.
      z.object({
        source: z.literal("existing"),
        account_id: z.number().int().positive(),
      }),
    ]),
  }),
  z.object({
    action: z.literal("update"),
    account_id: z.number().int().positive(),
    kind: accountKindSchema,
    institution: z.string().trim().min(1),
    name: z.string().trim().min(1),
    // Replaces the account's first identifier; the rest are kept.
    identifier: typedIdentifierSchema,
    parent_id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("remove"),
    account_id: z.number().int().positive(),
    // Also delete the ledger account, which has no transactions.
    delete_account: z.boolean(),
  }),
]);
export type StatementAccountChange = z.infer<
  typeof statementAccountChangeSchema
>;

export const statementAccountRefusalSchema = z.object({
  error: z.string(),
  code: z.enum([
    // The presets' own rules (`importPresetRefusalSchema`).
    ...importPresetRefusalCodeSchema.options,
    // An entry or a draft is on the account.
    "account_has_transactions",
    // The number isn't one a statement of that kind prints.
    "identifier_invalid",
    // The parent is not an account of the kind's type.
    "parent_not_suitable",
    // The ledger already has an account of that name.
    "ledger_name_taken",
    // The account to use is not an Asset or Liability of that kind, or a
    // preset already lists it.
    "account_not_suitable",
    // An account with accounts under it isn't deleted or changed in kind.
    "account_has_children",
  ]),
});
export type StatementAccountRefusal = z.infer<
  typeof statementAccountRefusalSchema
>;

export const setupContract = c.router({
  chartOfAccounts: c.query({
    method: "GET",
    path: "/setup/chart-of-accounts",
    summary:
      "The starter chart of accounts for books with no accounts, or the books' own chart",
    responses: {
      200: chartOfAccountsSchema,
      403: errorBodySchema,
    },
  }),
  chartSuggester: c.query({
    method: "GET",
    path: "/setup/chart-of-accounts/suggest",
    summary:
      "Which coding agent would propose a chart of accounts from a description, or why none can",
    responses: {
      200: llmStatusSchema,
      403: errorBodySchema,
    },
  }),
  suggestChartOfAccounts: c.mutation({
    method: "POST",
    path: "/setup/chart-of-accounts/suggest",
    summary:
      "Have the LLM revise the chart on screen to fit the user's description; one structured call that writes nothing",
    body: chartSuggestionRequestSchema,
    responses: {
      200: chartSuggestionSchema,
      403: errorBodySchema,
      502: chartSuggestionRefusalSchema,
      503: chartSuggestionRefusalSchema,
    },
  }),
  statementAccounts: c.query({
    method: "GET",
    path: "/setup/statement-accounts",
    summary:
      "The banks and cards statements come from: each preset account with its parent and its count of its own entries (the opening entry left out) and drafts",
    responses: {
      200: statementAccountsSchema,
      403: errorBodySchema,
    },
  }),
  changeStatementAccount: c.mutation({
    method: "POST",
    path: "/setup/statement-accounts",
    summary:
      "Create, change or remove one bank or card: its ledger account and its preset entry together, in one transaction",
    body: statementAccountChangeSchema,
    responses: {
      200: statementAccountsSchema,
      403: errorBodySchema,
      422: statementAccountRefusalSchema,
    },
  }),
  createChartOfAccounts: c.mutation({
    method: "POST",
    path: "/setup/chart-of-accounts",
    summary:
      "Create a chart of accounts in books with no accounts, parents before children, in one transaction",
    body: chartProposalSchema,
    responses: {
      201: z.object({ created: z.number().int() }),
      403: errorBodySchema,
      409: chartRefusalSchema,
      422: chartRefusalSchema,
    },
  }),
});
