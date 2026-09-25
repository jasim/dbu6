import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";

const c = initContract();

/*
 * The account setup wizard at /setup: the chart of accounts, the banks and
 * cards statements come from, and each one's statement format. The wizard
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
