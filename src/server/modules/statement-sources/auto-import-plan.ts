import type { StatementAccount } from "../../../shared/index.js";
import type { AbacusStatement } from "../statement/index.js";
import {
  resolveImportPreset,
  type ImportPreset,
  type ImportPresetRejectionReason,
} from "./import-presets.js";
import type { StatementRecognition } from "./statement-recognition.js";

// One uploaded file that exactly one saved parser claimed, with the statement
// that parser produced. `file` is the name the user uploaded, not the staged
// temp path, so every row of the plan is one the user can point at.
export interface RecognizedStatement {
  file: string;
  // The parser's name, as presets declare it, e.g. `hdfc-cc-xls`.
  parserName: string;
  statement: AbacusStatement;
}

// What running the saved parsers over one upload established, under the name
// the user uploaded it as. Detection is per file, so a batch can mix
// recognized and unrecognized files.
export type FileRecognition = StatementRecognition & { file: string };

// The account a recognized statement reports about itself, carried through the
// plan so every row explains itself whether or not it resolved to a preset.
interface ReportedAccount {
  parserName: string;
  account: StatementAccount | null;
  institution: string | null;
}

// One upload's place in the plan: the preset it will import into, or why it
// has none. `unrecognized` and `ambiguous` come from detection; `unresolved`
// means a parser read the file but no single preset claims it.
export type PlannedFile =
  | ({ status: "resolved"; file: string; presetName: string } & ReportedAccount)
  | { status: "unrecognized"; file: string; candidateParserNames: string[] }
  | { status: "ambiguous"; file: string; matchingParserNames: string[] }
  | ({
      status: "unresolved";
      file: string;
      reason: ImportPresetRejectionReason;
      message: string;
      candidatePresetNames: string[];
    } & ReportedAccount);

// One preset's share of the batch: the statements that resolved to it, in
// upload order. One group is one account import.
export interface AutoImportGroup {
  preset: ImportPreset;
  statements: RecognizedStatement[];
}

// Either every upload resolved to a preset and the groups say what to import,
// or at least one did not and nothing may be imported. `files` carries every
// upload in both cases, so a rejection is as explanatory as a success.
export type AutoImportPlan =
  | { ok: true; files: PlannedFile[]; groups: AutoImportGroup[] }
  | { ok: false; files: PlannedFile[] };

function reportedAccount(recognized: RecognizedStatement): ReportedAccount {
  return {
    parserName: recognized.parserName,
    account: recognized.statement.account,
    institution: recognized.statement.institution,
  };
}

// Decide what a batch of recognized uploads would import, without touching the
// ledger. Every file resolves through `resolveImportPreset`, and files sharing
// a preset become one group because one preset is one account.
//
// The batch is all-or-nothing: a single file the presets cannot place rejects
// the plan, so the user fixes their presets or drops the file rather than
// importing part of what they dropped.
export function planAutoImport(
  recognitions: readonly FileRecognition[],
  presets: readonly ImportPreset[],
): AutoImportPlan {
  const files: PlannedFile[] = [];
  const groups = new Map<ImportPreset, RecognizedStatement[]>();

  for (const recognition of recognitions) {
    if (recognition.outcome === "unrecognized") {
      files.push({
        status: "unrecognized",
        file: recognition.file,
        candidateParserNames: recognition.candidateParserNames,
      });
      continue;
    }
    if (recognition.outcome === "ambiguous") {
      files.push({
        status: "ambiguous",
        file: recognition.file,
        matchingParserNames: recognition.matchingParserNames,
      });
      continue;
    }

    const resolution = resolveImportPreset(presets, {
      file: recognition.file,
      parserName: recognition.parserName,
      identifier: recognition.statement.account?.identifier ?? null,
    });
    if (!resolution.ok) {
      files.push({
        status: "unresolved",
        file: recognition.file,
        reason: resolution.reason,
        message: resolution.message,
        candidatePresetNames: resolution.candidatePresetNames,
        ...reportedAccount(recognition),
      });
      continue;
    }

    files.push({
      status: "resolved",
      file: recognition.file,
      presetName: resolution.preset.name,
      ...reportedAccount(recognition),
    });
    const statements = groups.get(resolution.preset);
    const { outcome: _outcome, ...recognized } = recognition;
    if (statements) statements.push(recognized);
    else groups.set(resolution.preset, [recognized]);
  }

  if (files.some((file) => file.status !== "resolved")) {
    return { ok: false, files };
  }
  return {
    ok: true,
    files,
    groups: Array.from(groups, ([preset, statements]) => ({
      preset,
      statements,
    })),
  };
}
