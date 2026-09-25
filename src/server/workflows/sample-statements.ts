import { extname } from "node:path";
import {
  accountKindOf,
  statementFormatReady,
  type SampleFinding,
  type StatementFormatRow,
} from "../../shared/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  proposeSampleChanges,
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "../modules/statement-sources/index.js";

/*
 * Step 3 of the setup wizard: one sample statement per bank or card, to set
 * up the format its statements come in. A sample the saved parsers
 * recognize yields the preset changes that tie the account to the parser,
 * for the user to accept; one they don't stays staged (the route's
 * business) for a coding agent to write a parser from. Nothing here writes
 * to the books, and nothing in a sample is imported.
 */

export type SampleOutcome =
  | { ok: true; finding: RecognizedOrNot }
  | { ok: false; code: "unknown_account" };

// A finding before the route adds where an unread sample is staged.
export type RecognizedOrNot =
  | Extract<SampleFinding, { outcome: "recognized" }>
  | { outcome: "unrecognized"; tried: string[] }
  | { outcome: "ambiguous"; parsers: string[] };

/** What the sample at `filePath` shows for the preset account. */
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
      parser_institution: proposal.parserInstitution,
      institution: proposal.institution,
      moves: proposal.moves,
      identifier_state: proposal.identifierState,
      changes: proposal.changes,
      keep_mine: proposal.keepMine,
    },
  };
}

/**
 * Every preset account's statement format, given where each account's
 * staged sample is (a path in the project), if it has one.
 */
export function loadStatementFormats(
  ledger: Ledger,
  stagedSamples: ReadonlyMap<number, string>,
): StatementFormatRow[] {
  return loadImportPresets(ledger.db, ledger.auth).flatMap((institution) =>
    institution.accounts.map((account): StatementFormatRow => {
      const staged = stagedSamples.get(account.account_id) ?? null;
      return {
        account_id: account.account_id,
        name: account.name,
        kind: accountKindOf(account.is_credit_card),
        institution: institution.name,
        parsers: institution.parsers,
        account_identifiers: account.account_identifiers,
        status: statementFormatReady(institution, account)
          ? "ready"
          : staged !== null
            ? "waiting_for_parser"
            : "needs_sample",
        staged_sample: staged,
      };
    }),
  );
}
