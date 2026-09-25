import { extname } from "node:path";
import {
  accountKindOf,
  type FirstStatementRefusal,
  type FirstStatementRow,
  type FirstStatements,
  type ImportAccount,
  type ImportInstitution,
  type RecognizedFinding,
  type StatementActivity,
} from "../../shared/index.js";
import { loadLedgerAccounts } from "../modules/accounts/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { loadOpeningEntries } from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import type { AbacusStatement } from "../modules/statement/index.js";
import {
  proposeSampleChanges,
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "../modules/statement-sources/index.js";
import {
  categorizerStatus,
  hasTransactions,
  importFirstStatements,
  loadStatementActivity,
  statementOpening,
} from "./add-account.js";
import type {
  BatchImportOutcome,
  StagedStatement,
} from "./statement-import/index.js";

/*
 * Step 3 of the setup wizard: a first statement for each bank or card. The
 * saved parsers read it, which ties the account to its format; it gives the
 * account's opening balance; and it is imported as any statement is. The
 * upload stays staged (the route's business) until it is imported, so the
 * step reads where it stands from the books and the staged files alone.
 *
 * Importing is /add's sequence (`importFirstStatements`) for one file,
 * after this step's own refusals (unreadable, imported, a number that
 * differs from the one typed).
 *
 * /add replaces this step; it goes once the old wizard does.
 */

export type SampleOutcome =
  | { ok: true; finding: RecognizedOrNot }
  | { ok: false; code: "unknown_account" };

// A finding before the route adds where an unread statement is staged.
export type RecognizedOrNot =
  | RecognizedFinding
  | { outcome: "unrecognized"; tried: string[] }
  | { outcome: "ambiguous"; parsers: string[] };

// A reading, and when a parser read it, what that parser made of the file:
// what importing takes, so the file is parsed once per request.
type Reading =
  | {
      ok: true;
      finding: RecognizedOrNot;
      read: { parserName: string; statement: AbacusStatement } | null;
    }
  | { ok: false; code: "unknown_account" };

/** What the statement at `filePath` shows for the preset account. */
export async function recognizeSample(
  ledger: Ledger,
  accountId: number,
  filePath: string,
): Promise<SampleOutcome> {
  const reading = await readSample(ledger, accountId, filePath);
  return reading.ok ? { ok: true, finding: reading.finding } : reading;
}

async function readSample(
  ledger: Ledger,
  accountId: number,
  filePath: string,
): Promise<Reading> {
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
      read: null,
    };
  }
  if (recognition.outcome === "ambiguous") {
    return {
      ok: true,
      finding: {
        outcome: "ambiguous",
        parsers: recognition.matchingParserNames,
      },
      read: null,
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
  const existing = loadOpeningEntries(ledger.sqlite, ledger.auth, {
    accountId,
  }).get(accountId);
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
      existing_opening:
        existing === undefined
          ? null
          : { date: existing.date, amount: existing.amount },
      parser_institution: proposal.parserInstitution,
      institution: proposal.institution,
      moves: proposal.moves,
      identifier_state: proposal.identifierState,
      changes: proposal.changes,
    },
    read: { parserName, statement },
  };
}

/** A staged statement: where it is, and that path relative to the project. */
export interface StagedFile {
  path: string;
  projectPath: string;
}

/**
 * A bank or card as setup counts it: an account of an import preset, whether
 * the books still have it, and what it holds.
 */
export interface BankOrCard {
  institution: ImportInstitution;
  account: ImportAccount;
  // False when the preset names an account the books deleted: no statement
  // can go in, so setup counts it nowhere and asks for it to be removed.
  inLedger: boolean;
  activity: StatementActivity;
}

/** Every preset account, in the presets' order, as setup counts it. */
export function loadBanksAndCards(ledger: Ledger): BankOrCard[] {
  const activity = loadStatementActivity(ledger);
  const ledgerIds = new Set(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((one) => one.id),
  );
  return loadImportPresets(ledger.db, ledger.auth).flatMap((institution) =>
    institution.accounts.map((account) => ({
      institution,
      account,
      inLedger: ledgerIds.has(account.account_id),
      activity: activity(account.account_id),
    })),
  );
}

/**
 * Every preset account's first statement, in the presets' order, given
 * each account's staged statement if it has one; and who categorizes.
 */
export async function loadFirstStatements(
  ledger: Ledger,
  staged: ReadonlyMap<number, StagedFile>,
): Promise<FirstStatements> {
  const accounts: FirstStatementRow[] = [];
  for (const bank of loadBanksAndCards(ledger)) {
    const { institution, account } = bank;
    const row = {
      account_id: account.account_id,
      name: account.name,
      kind: accountKindOf(account.is_credit_card),
      institution: institution.name,
      account_identifiers: account.account_identifiers,
      activity: bank.activity,
    };
    const file = staged.get(account.account_id);
    if (!bank.inLedger) {
      accounts.push({ ...row, status: "not_in_ledger" });
    } else if (hasTransactions(row.activity)) {
      accounts.push({ ...row, status: "imported" });
    } else if (file === undefined) {
      accounts.push({ ...row, status: "needs_statement" });
    } else {
      const outcome = await recognizeSample(
        ledger,
        account.account_id,
        file.path,
      ).catch((error: unknown) => {
        // Imported, removed or replaced since the listing.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (outcome === null) {
        accounts.push({ ...row, status: "needs_statement" });
        continue;
      }
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
  return { categorizer: await categorizerStatus(), accounts };
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

const NOT_SET_UP = "That bank or card isn't set up any more.";

export type FirstStatementOutcome =
  | { ok: false; refusal: FirstStatementRefusal }
  | { ok: true; outcome: BatchImportOutcome };

/**
 * Imports an account's staged first statement, after tying the account to
 * its format and recording its opening balance. Refuses, writing nothing,
 * when the statement can't be imported as it stands: when the step's own
 * rules refuse it, and when the import's checks of the statement alone
 * would (its balances and closing), which come back as a failed import. Past
 * those, the import's own outcome says whether it went in.
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

  const reading = await readSample(ledger, accountId, request.statement.path);
  if (!reading.ok) {
    return refuse("unknown_account", NOT_SET_UP);
  }
  const { finding, read } = reading;
  if (finding.outcome !== "recognized" || read === null) {
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
  // The statement read above is the one imported, whatever the staged file
  // has become meanwhile.
  const done = await importFirstStatements(ledger, loadCategorizer, {
    accountId,
    statements: [
      {
        file: request.statement.name,
        parserName: read.parserName,
        statement: read.statement,
      },
    ],
    openingAmount: request.openingAmount,
  });
  if (!done.ok) return refuse(done.code, done.error);
  return done;
}
