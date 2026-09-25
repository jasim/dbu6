import path from "node:path";
import type { ImportInstitution } from "../../../shared/index.js";
import { loadLedgerAccounts } from "../../modules/accounts/index.js";
import {
  planAutoImport,
  type AutoImportGroup,
  type FileRecognition,
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
  AccountNotFoundError,
  importOptionsFromAccount,
  runStatementImport,
  type StatementImportResult,
} from "./statement-import.js";

// Automatic statement import: statement files, and optionally a Google Pay
// Takeout, and nothing else.
//
//   per file: savedCustomStatementParserNames(ext)
//             recognizeStatementFile(candidates, path)
//     -> planAutoImport(recognitions, institutions)   pure: groups, or a rejection
//     -> parseGPayHtml(takeout), once
//     -> per group: runStatementImport(statements, importOptionsFromAccount)
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
  institutions: readonly ImportInstitution[];
}

export interface ImportedGroup {
  group: AutoImportGroup;
  // The ledger account's name the group imported into.
  baseAccount: string;
  result: StatementImportResult;
}

// Every outcome carries what the plan decided for each file, whether or not
// anything was imported, so the user can fix the presets and retry.
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
      // The ledger account's name, or the preset's name when the ledger no
      // longer has the account.
      failedBaseAccount: string;
      error: ImportRefusal;
    };

export async function importStatementBatch(
  batch: StatementBatch,
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
): Promise<BatchImportOutcome> {
  const recognitions = await recognizeStatements(batch.statements);
  const plan = planAutoImport(recognitions, batch.institutions);
  if (!plan.ok) return { kind: "unplanned", files: plan.files };

  console.log(
    `[auto-statement-upload] importing ${plan.groups.length} account(s): ${plan.groups
      .map(
        (group) =>
          `${group.account.name} <- ${group.statements.map((one) => one.file).join(", ")}`,
      )
      .join("; ")}`,
  );
  const gpay =
    batch.gpayHtmlPath === null ? null : parseGPayHtml(batch.gpayHtmlPath);
  return importPlannedGroups(
    plan.files,
    plan.groups,
    gpay,
    ledger,
    loadCategorizer,
  );
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

// Each group is one account's ordinary statement import, into the ledger
// account its id names when the batch starts; an id the ledger no longer has
// refuses that group. Groups run in sequence and stop at the first that
// refuses. A caller that has already read and placed its statements (the
// setup wizard's first statement) starts here.
export async function importPlannedGroups(
  files: PlannedFile[],
  groups: readonly AutoImportGroup[],
  gpay: GPayIndex | null,
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
): Promise<BatchImportOutcome> {
  const imported: ImportedGroup[] = [];
  // One engine for the batch: every group categorizes on the same agent.
  const llm = await categorizationLlm();
  const ledgerNames = new Map(
    loadLedgerAccounts(ledger.sqlite, ledger.auth).map((account) => [
      account.id,
      account.name,
    ]),
  );

  for (const group of groups) {
    const ledgerName = ledgerNames.get(group.account.account_id);
    try {
      if (ledgerName === undefined) {
        throw new AccountNotFoundError(
          group.account.name,
          group.account.account_id,
        );
      }
      const result = await runStatementImport(
        group.statements.map((one) => one.statement),
        await importOptionsFromAccount(
          group.account,
          ledgerName,
          gpay,
          llm,
          loadCategorizer,
        ),
        ledger,
        group.statements.map((one) => one.file),
      );
      imported.push({ group, baseAccount: ledgerName, result });
    } catch (error) {
      if (!isImportRefusal(error)) throw error;
      return {
        kind: "failed",
        files,
        imported,
        failed: group,
        failedBaseAccount: ledgerName ?? group.account.name,
        error,
      };
    }
  }
  return { kind: "imported", files, imported };
}
