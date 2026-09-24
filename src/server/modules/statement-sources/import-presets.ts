import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  importPresetSchema,
  type ImportAccount,
  type ImportInstitution,
  type ImportPreset,
} from "../../../shared/index.js";
import { userConfigPath } from "../../paths.js";

export type { ImportPreset } from "../../../shared/index.js";

const importPresetsFileSchema = z.array(importPresetSchema);

// The one reader of user-config/import-presets.json. A missing file is
// the same as no presets; a malformed one is a configuration error and throws.
export async function readImportPresets(): Promise<ImportPreset[]> {
  let raw: string;
  try {
    raw = await readFile(userConfigPath("import-presets.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return importPresetsFileSchema.parse(JSON.parse(raw));
}

export interface ParsedStatementIdentity {
  // Name of the uploaded file, used only to make a rejection actionable.
  file: string;
  // The parser's name, exactly as presets declare it, e.g. `hdfc-cc-xls`.
  parserName: string;
  // The identifier the parser emitted, or null when it emitted none.
  identifier: string | null;
}

export type ImportPresetRejectionReason =
  | "no_preset_for_parser"
  | "statement_account_identifier_required"
  | "statement_account_identifier_mismatch";

export type ImportPresetResolution =
  | { ok: true; preset: ImportPreset }
  | ({
      ok: false;
      reason: ImportPresetRejectionReason;
      message: string;
      candidatePresetNames: string[];
    } & ParsedStatementIdentity);

// Pick the preset an auto-imported statement belongs to, from the parser that
// recognized it and the account identifier it reported.
//
// - A parser used by exactly one preset without an identifier matches that
//   preset outright; the statement's identifier, if any, is not checked.
// - A preset that carries an identifier only matches a statement reporting
//   the same one.
// - When several presets share a parser, the statement must report an
//   identifier that exactly one of them carries.
export function resolveImportPreset(
  presets: readonly ImportPreset[],
  statement: ParsedStatementIdentity,
): ImportPresetResolution {
  const candidates = presets.filter(
    (preset) => preset.custom_statement_parser_path === statement.parserName,
  );
  const candidatePresetNames = candidates.map((preset) => preset.name);
  const reject = (
    reason: ImportPresetRejectionReason,
    message: string,
  ): ImportPresetResolution => ({
    ok: false,
    reason,
    message,
    candidatePresetNames,
    ...statement,
  });

  if (candidates.length === 0) {
    return reject(
      "no_preset_for_parser",
      `No import preset uses ${statement.parserName}, which parsed ${statement.file}.`,
    );
  }

  if (candidates.length === 1) {
    const [preset] = candidates;
    if (preset.statement_account_identifier === undefined) {
      return { ok: true, preset };
    }
    if (statement.identifier === null) {
      return reject(
        "statement_account_identifier_required",
        `Preset "${preset.name}" expects account identifier ${preset.statement_account_identifier}, but ${statement.parserName} reported none for ${statement.file}.`,
      );
    }
    if (statement.identifier !== preset.statement_account_identifier) {
      return reject(
        "statement_account_identifier_mismatch",
        `${statement.file} reports account identifier ${statement.identifier}, but the only preset using ${statement.parserName} ("${preset.name}") expects ${preset.statement_account_identifier}.`,
      );
    }
    return { ok: true, preset };
  }

  if (statement.identifier === null) {
    return reject(
      "statement_account_identifier_required",
      `${candidates.length} presets use ${statement.parserName} (${candidatePresetNames.join(", ")}), but it reported no account identifier for ${statement.file}.`,
    );
  }
  const matching = candidates.filter(
    (preset) => preset.statement_account_identifier === statement.identifier,
  );
  if (matching.length === 1) {
    return { ok: true, preset: matching[0] };
  }
  return reject(
    "statement_account_identifier_mismatch",
    matching.length === 0
      ? `${statement.file} reports account identifier ${statement.identifier}, which none of the presets using ${statement.parserName} carry (${candidatePresetNames.join(", ")}).`
      : `${statement.file} reports account identifier ${statement.identifier}, which ${matching.length} presets using ${statement.parserName} carry (${matching.map((preset) => preset.name).join(", ")}).`,
  );
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
