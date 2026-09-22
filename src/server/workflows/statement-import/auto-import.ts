import path from "node:path";
import {
  planAutoImport,
  type AutoImportGroup,
  type FileRecognition,
  type ImportPreset,
  type PlannedFile,
  recognizeStatementFile,
  savedCustomStatementParserNames,
} from "../../modules/statement-sources/index.js";
import type { LoadCategorizer } from "../../modules/categorization/index.js";
import { categorizationLlm } from "../../modules/coding-agent/index.js";
import { parseGPayHtml, type GPayIndex } from "../../modules/gpay/index.js";
import type { Ledger } from "../../modules/ledger-sql/index.js";
import { isImportRefusal, type ImportRefusal } from "./refusals.js";
import {
  importOptionsFromPreset,
  runStatementImport,
  type StatementImportResult,
} from "./statement-import.js";

// Automatic statement import: statement files, and optionally a Google Pay
// Takeout, and nothing else.
//
//   per file: savedCustomStatementParserNames(ext)
//             recognizeStatementFile(candidates, path)
//     -> planAutoImport(recognitions, presets)   pure: groups, or a rejection
//     -> parseGPayHtml(takeout), once
//     -> per group: runStatementImport(statements, importOptionsFromPreset)
//
// The Takeout names UPI recipients in every account the batch imports.

// One uploaded statement: the name the user dropped it under, and where its
// staged copy is.
export interface StagedStatement {
  name: string;
  path: string;
}

export interface StatementBatch {
  statements: readonly StagedStatement[];
  gpayHtmlPath: string | null;
  presets: readonly ImportPreset[];
}

export interface ImportedGroup {
  group: AutoImportGroup;
  result: StatementImportResult;
}

// Every outcome carries what the plan decided for each file, whether or not
// anything was imported, so the user can fix a preset and retry.
export type BatchImportOutcome =
  // A file was unrecognized, ambiguous, or unplaced by the presets, so nothing
  // was imported: a partial import of a batch the user dropped as a unit is
  // harder to undo than a retry.
  | { kind: "unplanned"; files: PlannedFile[] }
  | { kind: "imported"; files: PlannedFile[]; imported: ImportedGroup[] }
  // A group's import refused. The groups before it stay imported.
  | {
      kind: "failed";
      files: PlannedFile[];
      imported: ImportedGroup[];
      failed: AutoImportGroup;
      error: ImportRefusal;
    };

export async function importStatementBatch(
  batch: StatementBatch,
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
): Promise<BatchImportOutcome> {
  const recognitions = await recognizeStatements(batch.statements);
  const plan = planAutoImport(recognitions, batch.presets);
  if (!plan.ok) return { kind: "unplanned", files: plan.files };

  console.log(
    `[auto-statement-upload] importing ${plan.groups.length} account(s): ${plan.groups
      .map(
        (group) =>
          `${group.preset.name} <- ${group.statements.map((one) => one.file).join(", ")}`,
      )
      .join("; ")}`,
  );
  const gpay =
    batch.gpayHtmlPath === null ? null : parseGPayHtml(batch.gpayHtmlPath);
  return importGroups(plan.files, plan.groups, gpay, ledger, loadCategorizer);
}

// Detection is per file so that one unreadable upload annotates its own row
// instead of ending the batch. A recognition is keyed by the name the file was
// uploaded under.
async function recognizeStatements(
  statements: readonly StagedStatement[],
): Promise<FileRecognition[]> {
  const recognitions: FileRecognition[] = [];
  for (const statement of statements) {
    const candidates = await savedCustomStatementParserNames(
      path.extname(statement.path),
    );
    recognitions.push({
      ...(await recognizeStatementFile(candidates, statement.path)),
      file: statement.name,
    });
  }
  return recognitions;
}

// One preset is one account, so each group is one ordinary statement import.
// Groups run in sequence and stop at the first that refuses.
async function importGroups(
  files: PlannedFile[],
  groups: readonly AutoImportGroup[],
  gpay: GPayIndex | null,
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
): Promise<BatchImportOutcome> {
  const imported: ImportedGroup[] = [];
  // One engine for the batch: every group categorizes on the same agent.
  const llm = await categorizationLlm();

  for (const group of groups) {
    try {
      const result = await runStatementImport(
        group.statements.map((one) => one.statement),
        await importOptionsFromPreset(group.preset, gpay, llm, loadCategorizer),
        ledger,
        group.statements.map((one) => one.file),
      );
      imported.push({ group, result });
    } catch (error) {
      if (!isImportRefusal(error)) throw error;
      return { kind: "failed", files, imported, failed: group, error };
    }
  }
  return { kind: "imported", files, imported };
}
