import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  accountKindOf,
  importPresetSchema,
  type ImportPreset,
} from "dbu6-shared";
import { userConfigPath } from "../user-data.js";
import type { CategorizationLlm } from "./categorization/llm-categorization.js";
import { parseAccount } from "../modules/values/index.js";
import type { ImportOptions } from "./statement-import.js";

export type { ImportPreset } from "dbu6-shared";

const importPresetsFileSchema = z.array(importPresetSchema);

// The one reader of data/user-config/import-presets.json. A missing file is
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
  // Parser path exactly as presets declare it, e.g.
  // `custom-built-parsers/hdfc-cc-xls/parser.py`.
  parserPath: string;
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
    (preset) => preset.custom_statement_parser_path === statement.parserPath,
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
      `No import preset uses ${statement.parserPath}, which parsed ${statement.file}.`,
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
        `Preset "${preset.name}" expects account identifier ${preset.statement_account_identifier}, but ${statement.parserPath} reported none for ${statement.file}.`,
      );
    }
    if (statement.identifier !== preset.statement_account_identifier) {
      return reject(
        "statement_account_identifier_mismatch",
        `${statement.file} reports account identifier ${statement.identifier}, but the only preset using ${statement.parserPath} ("${preset.name}") expects ${preset.statement_account_identifier}.`,
      );
    }
    return { ok: true, preset };
  }

  if (statement.identifier === null) {
    return reject(
      "statement_account_identifier_required",
      `${candidates.length} presets use ${statement.parserPath} (${candidatePresetNames.join(", ")}), but it reported no account identifier for ${statement.file}.`,
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
      ? `${statement.file} reports account identifier ${statement.identifier}, which none of the presets using ${statement.parserPath} carry (${candidatePresetNames.join(", ")}).`
      : `${statement.file} reports account identifier ${statement.identifier}, which ${matching.length} presets using ${statement.parserPath} carry (${matching.map((preset) => preset.name).join(", ")}).`,
  );
}

// How a preset decides an import. The Google Pay Takeout is the one choice
// made per upload rather than per account, so it arrives alongside.
export function importOptionsFromPreset(
  preset: ImportPreset,
  gpayHtmlPath: string | null,
  llm: CategorizationLlm,
): ImportOptions {
  return {
    baseAccount: parseAccount(preset.base_account),
    accountKind: accountKindOf(preset.is_credit_card),
    customMappingsFilenames: preset.custom_mappings_filenames,
    gpayHtmlPath,
    llm,
  };
}
