import type {
  ImportAccount,
  ImportInstitution,
} from "../../../shared/index.js";

export interface ParsedStatementIdentity {
  // Name of the uploaded file, used only to make a rejection actionable.
  file: string;
  // The parser's name, exactly as institutions list it, e.g. `hdfc-cc-xls`.
  parserName: string;
  // The identifier the parser emitted, or null when it emitted none.
  identifier: string | null;
}

export type ImportAccountRejectionReason =
  | "no_institution_for_parser"
  | "institution_has_no_accounts"
  | "statement_account_identifier_required"
  | "statement_account_identifier_mismatch";

export type ImportAccountResolution =
  | { ok: true; institution: ImportInstitution; account: ImportAccount }
  | ({
      ok: false;
      reason: ImportAccountRejectionReason;
      message: string;
      // The institution that lists the parser, or null when none does.
      institutionName: string | null;
      // Its accounts, by their preset names.
      candidateAccountNames: string[];
    } & ParsedStatementIdentity);

// The account an auto-imported statement belongs to, from the parser that
// claimed it and the identifier it printed. The institution listing the
// parser holds the candidates:
//
// - one account with no identifiers takes every statement;
// - otherwise the statement must print an identifier one account lists
//   (rule 5 makes it at most one).
export function resolveImportAccount(
  institutions: readonly ImportInstitution[],
  statement: ParsedStatementIdentity,
): ImportAccountResolution {
  const institution = institutions.find((one) =>
    one.parsers.includes(statement.parserName),
  );
  const accounts = institution?.accounts ?? [];
  const reject = (
    reason: ImportAccountRejectionReason,
    message: string,
  ): ImportAccountResolution => ({
    ok: false,
    reason,
    message,
    institutionName: institution?.name ?? null,
    candidateAccountNames: accounts.map((account) => account.name),
    ...statement,
  });

  if (!institution) {
    return reject(
      "no_institution_for_parser",
      `No institution lists ${statement.parserName}, which parsed ${statement.file}.`,
    );
  }
  if (accounts.length === 0) {
    return reject(
      "institution_has_no_accounts",
      `"${institution.name}" lists ${statement.parserName}, which parsed ${statement.file}, but has no accounts to import it into.`,
    );
  }

  if (accounts.length === 1 && accounts[0].account_identifiers.length === 0) {
    return { ok: true, institution, account: accounts[0] };
  }

  const expected =
    accounts.length === 1
      ? `"${accounts[0].name}" (${accounts[0].account_identifiers.join(", ")})`
      : `one of ${accounts.map((account) => `"${account.name}"`).join(", ")}`;
  if (statement.identifier === null) {
    return reject(
      "statement_account_identifier_required",
      `${statement.parserName} reported no account identifier for ${statement.file}, and "${institution.name}" needs one to pick ${expected}.`,
    );
  }
  const account = accounts.find((one) =>
    one.account_identifiers.includes(statement.identifier!),
  );
  if (!account) {
    return reject(
      "statement_account_identifier_mismatch",
      `${statement.file} reports account identifier ${statement.identifier}, which no account of "${institution.name}" lists; it expected ${expected}.`,
    );
  }
  return { ok: true, institution, account };
}
