// The books as hledger sees them, built in two steps: `buildHledgerBooks`
// turns the ledger's rows (`HledgerExportInput`, still in dbu6's terms) into
// `HledgerBooks`, already in hledger's terms (escaped account paths, amounts
// in paise, transactions placed in their files, assertions where hledger
// will check them); `renderHledgerBooks` then only prints it.

export type LedgerAccountType =
  "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";

/** An account as the ledger keeps it. */
export interface ExportAccount {
  id: number;
  name: string;
  parent_id: number | null;
  account_type: LedgerAccountType;
}

/** One journal line. Amounts are rupees, as the ledger stores them. */
export interface ExportEntry {
  id: number;
  account_id: number;
  debit: number;
  credit: number;
  // This account's own balance after this line, in the ledger's order
  // (date, journal id, entry id), debit positive; null when unasserted.
  assertion: number | null;
  comment: string | null;
  source_narration: string | null;
}

/** A posted journal. `date` is YYYY-MM-DD. */
export interface ExportJournal {
  id: number;
  date: string;
  description: string;
  entries: ExportEntry[];
}

/** A bank or card the import presets list, in the presets' order. */
export interface StatementAccount {
  account_id: number;
  name: string;
}

export interface HledgerExportInput {
  accounts: ExportAccount[];
  journals: ExportJournal[];
  statementAccounts: StatementAccount[];
}

// --- hledger's side ---

/** hledger's account type letters (`account … ; type: X`). */
export type HledgerAccountType = "A" | "L" | "E" | "R" | "X";

export interface HledgerAccountDeclaration {
  /** The full colon path, every segment escaped. */
  name: string;
  type: HledgerAccountType;
}

/** Whole paise: hledger checks balances and assertions exactly. */
export type Paise = number;

export interface HledgerPosting {
  account: string;
  amount: Paise;
  assertion: Paise | null;
  /** Safe to print after `;`, or null. */
  comment: string | null;
}

export interface HledgerTransaction {
  date: string;
  /** Safe to print after the status mark. */
  description: string;
  /** The dbu6 journal it comes from; null for an assertion-only one. */
  journalId: number | null;
  postings: HledgerPosting[];
}

export interface HledgerJournalFile {
  /** Relative to main.journal, as its `include` names it. */
  path: string;
  /** What the file holds, printed as its opening comment. */
  title: string;
  transactions: HledgerTransaction[];
}

export interface HledgerBooks {
  /** The commodity directive's sample amount: `1,00,00,000.00`. */
  commodity: string;
  /** Every account, parents before children, in display order. */
  accounts: HledgerAccountDeclaration[];
  /**
   * In include order: one file per statement account, then
   * general-journals.journal, then balance-assertions.journal when an
   * assertion had to move there.
   */
  files: HledgerJournalFile[];
}

/** One rendered file of the export. */
export interface RenderedFile {
  path: string;
  content: string;
}

// --- what dbu6 expects hledger to find ---

/**
 * dbu6-expected.json, which verify.py checks the export against. Amounts are
 * strings with two decimals (`"-1234.50"`), read as exact decimals. Account
 * balances are debit positive, as hledger keeps them; the balance sheet's
 * figures are as dbu6's Balance Sheet shows them, each section positive.
 */
export interface HledgerExpectations {
  version: 1;
  /** When the export was made, ISO 8601. */
  generated_at: string;
  /** The last journal's date, or null for empty books. */
  last_date: string | null;
  /** Every posted journal; each is one transaction with a dbu6-id tag. */
  journal_count: number;
  /** Every account with entries, by its hledger path. */
  accounts: ExpectedAccount[];
  balance_sheet: ExpectedBalanceSheet;
  /** Every balance assertion dbu6 recorded. */
  assertions: ExpectedAssertion[];
  /** A random handful of journals, a different set each export. */
  sample_transactions: ExpectedTransaction[];
}

export interface ExpectedAccount {
  account: string;
  type: HledgerAccountType;
  /** Its own entries' sum, subaccounts excluded. */
  balance: string;
}

/** dbu6's Balance Sheet over every journal. */
export interface ExpectedBalanceSheet {
  assets: string;
  liabilities: string;
  /** The equity accounts' total, Opening Balances included. */
  equity: string;
  /** Revenue less expenses, never closed: hledger's `is` net. */
  income_less_spending: string;
  /** equity + income_less_spending: hledger's `bs` net. */
  net_worth: string;
}

export interface ExpectedAssertion {
  dbu6_id: number;
  date: string;
  account: string;
  balance: string;
}

export interface ExpectedTransaction {
  dbu6_id: number;
  date: string;
  /** As hledger reads it: the exported, sanitized description. */
  description: string;
  postings: { account: string; amount: string }[];
}
