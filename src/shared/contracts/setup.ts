import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { dateSpanSchema } from "./date-span.js";
import {
  autoImportErrorSchema,
  autoImportResultSchema,
} from "./import-drafts.js";
import {
  importPresetChangeSchema,
  importPresetRefusalCodeSchema,
} from "./import-presets.js";

const c = initContract();

/*
 * The account setup wizard at /setup: the chart of accounts, the banks and
 * cards statements come from, and each one's first statement. The wizard
 * keeps no state of its own; where it stands is read from the books.
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

// Step 1: a new system (no accounts at all) starts from a proposal; one that
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

// Who would draw a chart from the user's description: the coding agent dbu6
// uses, on the engine categorization runs on, or why nobody can.
export const chartSuggesterSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true), name: z.string() }),
  z.object({ ready: z.literal(false), name: z.string(), reason: z.string() }),
]);
export type ChartSuggester = z.infer<typeof chartSuggesterSchema>;

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

// Step 2: the banks and cards statements come from, each an account in an
// import preset. A row can be changed only while its account has no
// transactions: no journal entry on it, and no draft from or to it.
export const statementAccountRowSchema = z.object({
  account_id: z.number().int(),
  // The preset's name for it, which the wizard keeps equal to the ledger's.
  name: z.string(),
  kind: accountKindSchema,
  institution: z.string(),
  account_identifiers: z.array(z.string()),
  // Where the ledger account sits; null for a top account.
  parent: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  // False when the preset names an account the ledger no longer has.
  in_ledger: z.boolean(),
  entries: z.number().int(),
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
  // The parent of a preset account of the same kind; null with none, when
  // the user picks one. Never inferred from names.
  default_parents: z.object({
    bank: z.number().int().nullable(),
    card: z.number().int().nullable(),
  }),
  // Asset and Liability accounts no preset lists, which a row can use
  // instead of a new account.
  unlisted: z.array(chartChoiceSchema.extend({ kind: accountKindSchema })),
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

// Step 3: a first statement for each bank or card. dbu6 reads it with the
// saved parsers, which sets up the format its statements come in, takes the
// account's opening balance from it, and imports it. The uploaded statement
// is staged until it is imported.

// The balance the account opened at, the day before the statement's first
// row: the statement's own opening, else its first printed balance less the
// rows up to it. Ledger sign: positive when held, negative when owed.
export const statementOpeningSchema = z.object({
  date: z.string(),
  // Null when the statement prints no balances, and the user gives it.
  amount: z.number().nullable(),
});
export type StatementOpening = z.infer<typeof statementOpeningSchema>;

export const recognizedFindingSchema = z.object({
  outcome: z.literal("recognized"),
  parser: z.string(),
  // The number the statement prints about itself, canonical; null when
  // it prints none.
  printed_identifier: z.string().nullable(),
  // The institution's name as the statement prints it, for reading only.
  printed_institution: z.string().nullable(),
  // The statement's first and last dates.
  period: dateSpanSchema.nullable(),
  transactions: z.number().int(),
  // Null for a statement with no rows.
  opening: statementOpeningSchema.nullable(),
  // The account has an opening entry already, so importing records none.
  has_opening_entry: z.boolean(),
  // The institution that lists the parser now, if any.
  parser_institution: z.string().nullable(),
  // The account's institution after the changes.
  institution: z.string(),
  // Whether the account moves to the institution listing the parser: a
  // parser belongs to one institution.
  moves: z.boolean(),
  identifier_state: z.enum(["none_printed", "set", "same", "different"]),
  // The preset changes importing makes, with the statement's number where
  // the account has another. The server derives them again when it imports.
  changes: z.array(importPresetChangeSchema),
});
export type RecognizedFinding = z.infer<typeof recognizedFindingSchema>;

// A statement no saved parser reads, or more than one does. It stays
// staged at `saved_path` (in the project) for a coding agent.
const unreadableFindingSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("unrecognized"),
    saved_path: z.string(),
    // The saved parsers for the file's extension that rejected it.
    tried: z.array(z.string()),
  }),
  z.object({
    outcome: z.literal("ambiguous"),
    saved_path: z.string(),
    parsers: z.array(z.string()),
  }),
]);
export type UnreadableFinding = z.infer<typeof unreadableFindingSchema>;

// What a statement showed. Reading one writes nothing to the books.
export const sampleFindingSchema = z.union([
  recognizedFindingSchema,
  unreadableFindingSchema,
]);
export type SampleFinding = z.infer<typeof sampleFindingSchema>;

export const sampleRefusalSchema = z.object({
  error: z.string(),
  code: z.enum([
    // No `file` in the upload.
    "missing_multipart_field",
    // No preset lists the account.
    "unknown_account",
    // Check again, with no staged statement for the account.
    "no_staged_sample",
  ]),
});

// What a bank or card holds so far: posted entries (its opening entry left
// out) and drafts from its own statements, of which `uncategorized` have no
// category yet.
export const statementActivitySchema = z.object({
  entries: z.number().int(),
  drafts: z.number().int(),
  uncategorized: z.number().int(),
});
export type StatementActivity = z.infer<typeof statementActivitySchema>;

const firstStatementBaseSchema = z.object({
  account_id: z.number().int(),
  name: z.string(),
  kind: accountKindSchema,
  institution: z.string(),
  account_identifiers: z.array(z.string()),
  activity: statementActivitySchema,
});

// One bank or card, in exactly one state, read from the books and the
// staged statement: nothing yet; a staged statement a saved parser reads;
// one none reads, or several do; or transactions in the books.
export const firstStatementRowSchema = z.discriminatedUnion("status", [
  firstStatementBaseSchema.extend({ status: z.literal("needs_statement") }),
  firstStatementBaseSchema.extend({
    status: z.literal("read"),
    finding: recognizedFindingSchema,
  }),
  firstStatementBaseSchema.extend({
    status: z.literal("unreadable"),
    finding: unreadableFindingSchema,
  }),
  firstStatementBaseSchema.extend({ status: z.literal("imported") }),
]);
export type FirstStatementRow = z.infer<typeof firstStatementRowSchema>;
export type FirstStatementStatus = FirstStatementRow["status"];

// Who categorizes an import, or why nobody can: the check categorization
// itself makes.
export const categorizerStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true), name: z.string() }),
  z.object({ ready: z.literal(false), name: z.string(), reason: z.string() }),
]);
export type CategorizerStatus = z.infer<typeof categorizerStatusSchema>;

export const firstStatementsSchema = z.object({
  categorizer: categorizerStatusSchema,
  // In the order the banks and cards step lists them.
  accounts: z.array(firstStatementRowSchema),
});
export type FirstStatements = z.infer<typeof firstStatementsSchema>;

export const firstStatementRequestSchema = z.object({
  account_id: z.number().int().positive(),
  // What the account held the day before the statement's first row, ledger
  // sign; used only when the statement prints no balances.
  opening_amount: z.number().finite().optional(),
  // The user accepted the statement's number over the one they typed.
  use_statement_number: z.boolean().optional(),
});
export type FirstStatementRequest = z.infer<typeof firstStatementRequestSchema>;

export const firstStatementRefusalSchema = z.object({
  error: z.string(),
  code: z.enum([
    // No staged statement for the account: upload one.
    "no_staged_statement",
    // The account has transactions; its statements go through Import.
    "already_imported",
    // No saved parser reads the staged statement, or more than one does.
    "statement_unreadable",
    // The statement's number isn't the one typed, and it wasn't accepted.
    "numbers_differ",
    // The statement has no rows.
    "statement_has_no_transactions",
    // The statement prints no balances, and no `opening_amount` was given.
    "opening_balance_needed",
    // The opening entry couldn't be posted.
    "opening_balance_refused",
    // The presets' own rules (`importPresetRefusalSchema`), and
    // `unknown_account` when no preset lists the account.
    ...importPresetRefusalCodeSchema.options,
  ]),
});
export type FirstStatementRefusal = z.infer<typeof firstStatementRefusalSchema>;

// Where the wizard stands, counted in the books.
export const setupStatusSchema = z.object({
  // Accounts in the books; step 1 is done with any.
  accounts: z.number().int(),
  // Accounts an import preset lists; step 2 is done with any.
  preset_accounts: z.number().int(),
  // Preset accounts whose statement format is set up
  // (`statementFormatReady`).
  ready_accounts: z.number().int(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

/**
 * Whether a preset account's statements can be imported without asking:
 * its institution lists a parser, and it has an identifier to tell it from
 * the institution's other accounts.
 */
export function statementFormatReady(
  institution: { parsers: readonly string[] },
  account: { account_identifiers: readonly unknown[] },
): boolean {
  return (
    institution.parsers.length > 0 && account.account_identifiers.length > 0
  );
}

export const setupContract = c.router({
  setupStatus: c.query({
    method: "GET",
    path: "/setup",
    summary: "Where the account setup wizard stands, counted in the books",
    responses: {
      200: setupStatusSchema,
      403: errorBodySchema,
    },
  }),
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
      200: chartSuggesterSchema,
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
      "The banks and cards statements come from: each preset account with its parent and its count of entries and drafts",
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
  firstStatements: c.query({
    method: "GET",
    path: "/setup/first-statements",
    summary:
      "Each bank or card's first statement: none yet, a staged one a saved parser reads (with what it shows), a staged one none reads, or imported; and who categorizes. Staged statements of accounts that are imported or no longer set up are deleted.",
    responses: {
      200: firstStatementsSchema,
      403: errorBodySchema,
    },
  }),
  uploadSampleStatement: c.mutation({
    method: "POST",
    path: "/setup/sample-statement",
    summary:
      "Stage one statement (`file`) as a preset account's (`account_id`) first statement under tmp/statement-uploads/, replacing any earlier one, and read it with the saved parsers, writing nothing to the books",
    contentType: "multipart/form-data",
    // The statement is the `file` part.
    body: z.object({ account_id: z.coerce.number().int().positive() }),
    responses: {
      200: sampleFindingSchema,
      400: sampleRefusalSchema,
      403: errorBodySchema,
      404: sampleRefusalSchema,
    },
  }),
  importFirstStatement: c.mutation({
    method: "POST",
    path: "/setup/first-statement",
    summary:
      "Import an account's staged first statement: read it again, apply the preset changes it implies, record the opening balance (the statement's, else `opening_amount`) unless the account has one, then import it as /import-draft/statements/auto does, categorization included. Replies as that route does; the staged file is deleted once imported",
    body: firstStatementRequestSchema,
    responses: {
      200: autoImportResultSchema,
      400: autoImportErrorSchema,
      403: errorBodySchema,
      404: firstStatementRefusalSchema,
      409: firstStatementRefusalSchema,
      422: z.union([firstStatementRefusalSchema, autoImportErrorSchema]),
    },
  }),
  recheckSampleStatement: c.mutation({
    method: "POST",
    path: "/setup/sample-statement/recheck",
    summary:
      "Read an account's staged first statement again, after a parser was written for it",
    body: z.object({ account_id: z.number().int().positive() }),
    responses: {
      200: sampleFindingSchema,
      403: errorBodySchema,
      404: sampleRefusalSchema,
    },
  }),
  removeSampleStatement: c.mutation({
    method: "DELETE",
    path: "/setup/sample-statement/:accountId",
    summary: "Delete an account's staged first statement",
    pathParams: z.object({ accountId: z.coerce.number().int().positive() }),
    body: z.object({}).optional(),
    responses: {
      200: z.object({ removed: z.boolean() }),
      403: errorBodySchema,
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
