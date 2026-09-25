import { extname } from "node:path";
import { Temporal } from "@sapporta/shared/temporal";
import {
  accountKindOf,
  type CategorizerStatus,
  type FirstStatementRefusal,
  type FirstStatementRow,
  type FirstStatements,
  type ImportInstitution,
  type RecognizedFinding,
  type StatementActivity,
  type StatementOpening,
} from "../../shared/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { categorizationLlm } from "../modules/coding-agent/index.js";
import { loadDraftStatus } from "../modules/drafts/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import {
  countEntriesByAccount,
  loadOpeningEntries,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import type { AbacusStatement } from "../modules/statement/index.js";
import {
  proposeSampleChanges,
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "../modules/statement-sources/index.js";
import { changeImportPresets } from "./import-presets.js";
import { recordOpeningBalance } from "./opening-balances.js";
import {
  importStatementBatch,
  type BatchImportOutcome,
  type StagedStatement,
} from "./statement-import/index.js";

/*
 * Step 3 of the setup wizard: a first statement for each bank or card. The
 * saved parsers read it, which ties the account to its format; it gives the
 * account's opening balance; and it is imported as any statement is. The
 * upload stays staged (the route's business) until it is imported, so the
 * step reads where it stands from the books and the staged files alone.
 *
 * Importing sequences three workflows, and so sits above them:
 *
 *   recognizeSample                    read the staged file again
 *     -> changeImportPresets           the format, a move, the number
 *     -> recordOpeningBalance          unless the account has one
 *     -> importStatementBatch          the /import tail, categorization too
 *
 * The presets and the opening entry are two transactions: the presets'
 * writer checks parsers on disk before its own, which one SQLite transaction
 * can't wait for. The opening is checked before the presets change, so only
 * a request racing this one can leave the presets changed without it, and
 * they are right either way.
 */

export type SampleOutcome =
  | { ok: true; finding: RecognizedOrNot }
  | { ok: false; code: "unknown_account" };

// A finding before the route adds where an unread statement is staged.
export type RecognizedOrNot =
  | RecognizedFinding
  | { outcome: "unrecognized"; tried: string[] }
  | { outcome: "ambiguous"; parsers: string[] };

/** What the statement at `filePath` shows for the preset account. */
export async function recognizeSample(
  ledger: Ledger,
  accountId: number,
  filePath: string,
): Promise<SampleOutcome> {
  const listed = loadImportPresets(ledger.db, ledger.auth).some((one) =>
    one.accounts.some((account) => account.account_id === accountId),
  );
  if (!listed) return { ok: false, code: "unknown_account" };

  const parsers = await savedCustomStatementParserNames(extname(filePath));
  const recognition = await recognizeStatementFile(parsers, filePath);
  if (recognition.outcome === "unrecognized") {
    return {
      ok: true,
      finding: {
        outcome: "unrecognized",
        tried: recognition.candidateParserNames,
      },
    };
  }
  if (recognition.outcome === "ambiguous") {
    return {
      ok: true,
      finding: {
        outcome: "ambiguous",
        parsers: recognition.matchingParserNames,
      },
    };
  }

  const { parserName, statement } = recognition;
  const printed = statement.account?.identifier ?? null;
  // Read again after the parser ran: it takes a while, and the presets are
  // what the changes are made against.
  const proposal = proposeSampleChanges(
    loadImportPresets(ledger.db, ledger.auth),
    accountId,
    parserName,
    printed,
  );
  if (proposal === null) return { ok: false, code: "unknown_account" };
  const rows = statement.transactions;
  return {
    ok: true,
    finding: {
      outcome: "recognized",
      parser: parserName,
      printed_identifier: printed,
      printed_institution: statement.institution,
      period:
        rows.length === 0
          ? null
          : { first_date: rows[0].date, last_date: rows[rows.length - 1].date },
      transactions: rows.length,
      opening: statementOpening(statement),
      has_opening_entry: loadOpeningEntries(ledger.sqlite, ledger.auth, {
        accountId,
      }).has(accountId),
      parser_institution: proposal.parserInstitution,
      institution: proposal.institution,
      moves: proposal.moves,
      identifier_state: proposal.identifierState,
      changes: proposal.changes,
    },
  };
}

/**
 * The balance the account held the day before the statement's first row:
 * the opening it prints, else its first printed balance less the rows up to
 * and including that one. The amount is null when it prints no balance.
 */
export function statementOpening(
  statement: AbacusStatement,
): StatementOpening | null {
  const rows = statement.transactions;
  if (rows.length === 0) return null;
  const date = Temporal.PlainDate.from(rows[0].date)
    .subtract({ days: 1 })
    .toString();
  if (statement.opening !== null) return { date, amount: statement.opening };
  const first = rows.findIndex((row) => row.balance !== null);
  if (first === -1) return { date, amount: null };
  const moved = rows
    .slice(0, first + 1)
    .reduce((sum, row) => sum + row.deposit - row.withdrawal, 0);
  // To the paisa: the sum is float arithmetic.
  return {
    date,
    amount: Math.round((rows[first].balance! - moved) * 100) / 100,
  };
}

/** A staged statement: where it is, and that path relative to the project. */
export interface StagedFile {
  path: string;
  projectPath: string;
}

/**
 * Every preset account's first statement, in the presets' order, given
 * each account's staged statement if it has one; and who categorizes.
 */
export async function loadFirstStatements(
  ledger: Ledger,
  staged: ReadonlyMap<number, StagedFile>,
): Promise<FirstStatements> {
  const activity = loadStatementActivity(ledger);
  const accounts: FirstStatementRow[] = [];
  for (const institution of loadImportPresets(ledger.db, ledger.auth)) {
    for (const account of institution.accounts) {
      const row = {
        account_id: account.account_id,
        name: account.name,
        kind: accountKindOf(account.is_credit_card),
        institution: institution.name,
        account_identifiers: account.account_identifiers,
        activity: activity(account.account_id),
      };
      const file = staged.get(account.account_id);
      if (hasTransactions(row.activity)) {
        accounts.push({ ...row, status: "imported" });
      } else if (file === undefined) {
        accounts.push({ ...row, status: "needs_statement" });
      } else {
        const outcome = await recognizeSample(
          ledger,
          account.account_id,
          file.path,
        );
        // The account is listed, so it is known; only a race says otherwise.
        if (!outcome.ok) continue;
        const { finding } = outcome;
        accounts.push(
          finding.outcome === "recognized"
            ? { ...row, status: "read", finding }
            : {
                ...row,
                status: "unreadable",
                finding: { ...finding, saved_path: file.projectPath },
              },
        );
      }
    }
  }
  return { categorizer: await categorizerStatus(), accounts };
}

// Who categorizes an import: the engine the import itself asks.
async function categorizerStatus(): Promise<CategorizerStatus> {
  const llm = await categorizationLlm();
  return llm.caller.ready
    ? { ready: true, name: llm.name }
    : { ready: false, name: llm.name, reason: llm.caller.reason };
}

/**
 * Whether a bank or card's first statement is in: it has entries or drafts.
 * Its row is then `imported`, and the setup wizard's status counts it.
 */
export function hasTransactions(activity: StatementActivity): boolean {
  return activity.entries > 0 || activity.drafts > 0;
}

/**
 * Each account's entries, its opening entry left out, and the drafts from
 * its own statements.
 */
export function loadStatementActivity(
  ledger: Ledger,
): (accountId: number) => StatementActivity {
  const { sqlite, auth } = ledger;
  const entries = countEntriesByAccount(sqlite, auth);
  const openings = loadOpeningEntries(sqlite, auth);
  const drafts = loadDraftStatus(sqlite, auth);
  return (accountId) => ({
    entries: (entries.get(accountId) ?? 0) - (openings.has(accountId) ? 1 : 0),
    drafts: drafts.get(accountId)?.drafts ?? 0,
    uncategorized: drafts.get(accountId)?.uncategorised ?? 0,
  });
}

export interface FirstStatementImport {
  accountId: number;
  // The staged file, under the name it was uploaded as.
  statement: StagedStatement;
  // Ledger sign; used only when the statement prints no balances.
  openingAmount: number | null;
  // The user took the statement's number over the one they typed.
  useStatementNumber: boolean;
}

export type FirstStatementOutcome =
  | { ok: false; refusal: FirstStatementRefusal }
  | { ok: true; outcome: BatchImportOutcome };

/**
 * Imports an account's staged first statement, after tying the account to
 * its format and recording its opening balance. Refuses, writing nothing,
 * when the statement can't be imported as it stands; the import's own
 * outcome says whether it went in.
 */
export async function importFirstStatement(
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
  request: FirstStatementImport,
): Promise<FirstStatementOutcome> {
  const { accountId } = request;
  const refuse = (
    code: FirstStatementRefusal["code"],
    error: string,
  ): FirstStatementOutcome => ({ ok: false, refusal: { code, error } });

  const read = await recognizeSample(ledger, accountId, request.statement.path);
  if (!read.ok) {
    return refuse(
      "unknown_account",
      "That bank or card isn't set up any more.",
    );
  }
  const finding = read.finding;
  if (finding.outcome !== "recognized") {
    return refuse(
      "statement_unreadable",
      "dbu6 can't read this statement yet. Teach it the format, then check again.",
    );
  }
  if (hasTransactions(loadStatementActivity(ledger)(accountId))) {
    return refuse(
      "already_imported",
      "This account has transactions already. Import its statements on the Import page.",
    );
  }
  if (finding.identifier_state === "different" && !request.useStatementNumber) {
    return refuse(
      "numbers_differ",
      `The statement shows ${finding.printed_identifier}, not the number you entered. Use the statement's number, or upload another file.`,
    );
  }
  if (finding.opening === null) {
    return refuse(
      "statement_has_no_transactions",
      "The statement has no transactions to import.",
    );
  }
  const opening = finding.has_opening_entry
    ? null
    : (finding.opening.amount ?? request.openingAmount);
  if (!finding.has_opening_entry && opening === null) {
    return refuse(
      "opening_balance_needed",
      `The statement prints no balances. Enter what the account held on ${finding.opening.date}.`,
    );
  }

  if (finding.changes.length > 0) {
    const changed = await changeImportPresets(ledger, finding.changes);
    if (!changed.ok) {
      return refuse(changed.problem.code, changed.problem.message);
    }
  }
  if (opening !== null) {
    const recorded = recordOpeningBalance(ledger, {
      accountId,
      date: finding.opening.date,
      amount: opening,
    });
    // Recorded meanwhile by another request: the statement goes in on it.
    if (recorded.kind !== "recorded" && recorded.kind !== "already-recorded") {
      return refuse("opening_balance_refused", openingRefusal(recorded.kind));
    }
  }

  return {
    ok: true,
    outcome: await importStatementBatch(
      {
        statements: [request.statement],
        gpayHtmlPath: null,
        institutions: onlyAccount(
          loadImportPresets(ledger.db, ledger.auth),
          accountId,
        ),
      },
      ledger,
      loadCategorizer,
    ),
  };
}

function openingRefusal(
  kind:
    | "account-not-found"
    | "not-asset-or-liability"
    | "date-not-before-first-activity"
    | "opening-balances-not-equity",
): string {
  switch (kind) {
    case "account-not-found":
      return "The account was deleted from your books.";
    case "not-asset-or-liability":
      return "The account isn't an asset or a liability, so it takes no opening balance.";
    case "date-not-before-first-activity":
      return "The account has transactions before this statement starts.";
    case "opening-balances-not-equity":
      return "Your books have an account named Opening Balances that isn't Equity. Rename it on the Accounts page.";
  }
}

// The presets with the account alone in its institution, and without its
// numbers: the statement was uploaded for this account, so it is this
// account's whatever number it prints.
function onlyAccount(
  institutions: readonly ImportInstitution[],
  accountId: number,
): ImportInstitution[] {
  return institutions.map((institution) => ({
    ...institution,
    accounts: institution.accounts
      .filter((account) => account.account_id === accountId)
      .map((account) => ({ ...account, account_identifiers: [] })),
  }));
}
