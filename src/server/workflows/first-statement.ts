import { extname } from "node:path";
import { Temporal } from "@sapporta/shared/temporal";
import {
  accountKindOf,
  type CategorizerStatus,
  type FirstStatementRefusal,
  type FirstStatementRow,
  type FirstStatements,
  type ImportAccount,
  type ImportInstitution,
  type RecognizedFinding,
  type StatementActivity,
  type StatementOpening,
} from "../../shared/index.js";
import { loadLedgerAccounts } from "../modules/accounts/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import { categorizationLlm } from "../modules/coding-agent/index.js";
import { loadDraftStatus } from "../modules/drafts/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import {
  countOwnEntriesByAccount,
  loadOpeningEntries,
  lookupLastReconciled,
} from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import type { AbacusStatement } from "../modules/statement/index.js";
import {
  proposeSampleChanges,
  recognizeStatementFile,
  savedCustomStatementParserNames,
  type AutoImportGroup,
  type PlannedFile,
} from "../modules/statement-sources/index.js";
import { parseAccount, sameAmount } from "../modules/values/index.js";
import { changeImportPresets } from "./import-presets.js";
import {
  loadOpeningBalances,
  recordOpeningBalance,
} from "./opening-balances.js";
import {
  checkStatement,
  importPlannedGroups,
  isImportRefusal,
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
 *   readSample                         the staged file, parsed once
 *     -> openingToRecord, checkStatement   refusals, before any write
 *     -> changeImportPresets           the format, a move, the number
 *     -> recordOpeningBalance          unless the account has one
 *     -> importPlannedGroups           the /import tail, categorization too
 *
 * The presets and the opening entry are two transactions: the presets'
 * writer checks parsers on disk before its own, which one SQLite transaction
 * can't wait for. Everything the statement alone can refuse is checked
 * before either, so only the import's own tail (categorization, duplicates)
 * or a request racing this one can leave them written without the drafts,
 * and they are right either way.
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

/**
 * The balance the account held the day before the statement's first row:
 * the opening it prints; else its first printed balance less the rows up to
 * and including that one; else the closing it prints less every row. The
 * amount is null when it prints no balance at all.
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
  const [balance, through] =
    first !== -1
      ? [rows[first].balance!, first + 1]
      : [statement.closing, rows.length];
  if (balance === null) return { date, amount: null };
  const moved = rows
    .slice(0, through)
    .reduce((sum, row) => sum + row.deposit - row.withdrawal, 0);
  // To the paisa: the sum is float arithmetic.
  return { date, amount: Math.round((balance - moved) * 100) / 100 };
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
 * Each account's own entries (`countOwnEntriesByAccount`), its opening entry
 * left out, and the drafts from its own statements. The one rule for whether
 * a bank or card is imported: the step's rows, its import and GET /setup
 * all read it.
 */
export function loadStatementActivity(
  ledger: Ledger,
): (accountId: number) => StatementActivity {
  const { sqlite, auth } = ledger;
  // Its own: a card payment another account's import posted to it is not
  // this account's statement.
  const entries = countOwnEntriesByAccount(sqlite, auth);
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
  if (finding.opening === null || finding.period === null) {
    return refuse(
      "statement_has_no_transactions",
      "The statement has no transactions to import.",
    );
  }
  const ledgerAccount = loadLedgerAccounts(ledger.sqlite, ledger.auth).find(
    (one) => one.id === accountId,
  );
  if (ledgerAccount === undefined) {
    return refuse(
      "opening_balance_refused",
      openingRefusal("account-not-found"),
    );
  }

  const opening = openingToRecord(ledger, accountId, request, {
    opening: finding.opening,
    firstDate: finding.period.first_date,
    existing: finding.existing_opening,
  });
  if (!opening.ok) return refuse(opening.code, opening.error);

  // The statement's own checks, before anything is written: a statement
  // that would fail them leaves the presets and the books as they were.
  const home = presetHome(ledger, accountId);
  if (home === null) {
    return refuse("unknown_account", NOT_SET_UP);
  }
  const baseAccount = parseAccount(ledgerAccount.name);
  const planned = plannedStatement(request.statement.name, read, home);
  try {
    checkStatement(
      [read.statement],
      { baseAccount, accountKind: accountKindOf(home.account.is_credit_card) },
      opening.amount ??
        lookupLastReconciled(ledger.sqlite, ledger.auth, baseAccount)
          ?.balance ??
        null,
      [request.statement.name],
    );
  } catch (error) {
    if (!isImportRefusal(error)) throw error;
    return {
      ok: true,
      outcome: {
        kind: "failed",
        files: planned.files,
        imported: [],
        failed: planned.group,
        failedBaseAccount: ledgerAccount.name,
        error,
      },
    };
  }

  if (finding.changes.length > 0) {
    const changed = await changeImportPresets(ledger, finding.changes);
    if (!changed.ok) {
      return refuse(changed.problem.code, changed.problem.message);
    }
  }
  if (opening.amount !== null) {
    const recorded = recordOpeningBalance(ledger, {
      accountId,
      date: finding.opening.date,
      amount: opening.amount,
    });
    // Recorded meanwhile by another request: the statement goes in on it.
    if (recorded.kind !== "recorded" && recorded.kind !== "already-recorded") {
      return refuse("opening_balance_refused", openingRefusal(recorded.kind));
    }
  }

  // The account as the presets have it now; the statement read above is the
  // one imported, whatever the staged file has become meanwhile.
  const after = presetHome(ledger, accountId);
  if (after === null) {
    return refuse("unknown_account", NOT_SET_UP);
  }
  const { files, group } = plannedStatement(
    request.statement.name,
    read,
    after,
  );
  return {
    ok: true,
    outcome: await importPlannedGroups(
      files,
      [group],
      null,
      ledger,
      loadCategorizer,
    ),
  };
}

type OpeningDecision =
  // The amount to record, or null to record none: the account has one.
  | { ok: true; amount: number | null }
  | { ok: false; code: FirstStatementRefusal["code"]; error: string };

/*
 * The opening entry the import records, or why it can't go ahead. An
 * account with an opening entry keeps it, as long as the statement starts
 * after it: rows on or before its date would fall behind the balance the
 * books already check, and the import would drop them. When it is dated
 * the day before the statement starts, it must be the statement's balance
 * there. Else the opening is the statement's, or the typed one; and nothing
 * may sit on the account before it, which only another account's import can
 * have posted (a card payment from the bank's statement, say): the opening
 * would then check a balance that already moved.
 */
function openingToRecord(
  ledger: Ledger,
  accountId: number,
  request: FirstStatementImport,
  statement: {
    // The day before the first row, and the balance the statement gives it.
    opening: StatementOpening;
    firstDate: string;
    existing: RecognizedFinding["existing_opening"];
  },
): OpeningDecision {
  const { opening, firstDate, existing } = statement;
  const starts = opening.date;
  if (existing !== null) {
    if (existing.date > starts) {
      return {
        ok: false,
        code: "opening_after_statement_start",
        error: `Your books start this account on ${existing.date}, but this statement begins on ${firstDate}. Upload a statement that starts after ${existing.date}.`,
      };
    }
    if (
      existing.date === starts &&
      opening.amount !== null &&
      !sameAmount(existing.amount, opening.amount)
    ) {
      return {
        ok: false,
        code: "opening_disagrees",
        error: `Your books open this account at ${amountText(existing.amount)} on ${existing.date}, but this statement starts from ${amountText(opening.amount)}. Upload the statement that follows on from it.`,
      };
    }
    return { ok: true, amount: null };
  }

  const amount = opening.amount ?? request.openingAmount;
  if (amount === null) {
    return {
      ok: false,
      code: "opening_balance_needed",
      error: `The statement prints no balances. Enter what the account held on ${starts}.`,
    };
  }
  const first = loadOpeningBalances(ledger).accounts.find(
    (one) => one.accountId === accountId,
  )?.firstActivityDate;
  if (first !== undefined && first !== null && first <= starts) {
    return {
      ok: false,
      code: "activity_before_statement",
      error: `Another account's statement put a transaction on this account on ${first}, before this statement begins. Upload an earlier statement, one that covers ${first}.`,
    };
  }
  return { ok: true, amount };
}

// The institution and preset account the statement was uploaded for.
function presetHome(
  ledger: Ledger,
  accountId: number,
): { institution: ImportInstitution; account: ImportAccount } | null {
  for (const institution of loadImportPresets(ledger.db, ledger.auth)) {
    const account = institution.accounts.find(
      (one) => one.account_id === accountId,
    );
    if (account !== undefined) return { institution, account };
  }
  return null;
}

// The statement placed in the account it was uploaded for, as the batch
// import's plan would place it: whatever number it prints, it is this
// account's.
function plannedStatement(
  file: string,
  read: { parserName: string; statement: AbacusStatement },
  home: { institution: ImportInstitution; account: ImportAccount },
): { files: PlannedFile[]; group: AutoImportGroup } {
  return {
    files: [
      {
        status: "resolved",
        file,
        accountId: home.account.account_id,
        accountName: home.account.name,
        parserName: read.parserName,
        account: read.statement.account,
        institution: read.statement.institution,
      },
    ],
    group: {
      institution: home.institution,
      account: home.account,
      statements: [
        { file, parserName: read.parserName, statement: read.statement },
      ],
    },
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

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// An amount as the screens show one, in a refusal's words.
function amountText(amount: number): string {
  return money.format(amount);
}
