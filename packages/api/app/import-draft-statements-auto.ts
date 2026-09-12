import path from "node:path";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  importDraftsContract,
  type AutoImportFailedGroup,
  type AutoImportGroupResult,
  type AutoImportPlanFile,
} from "dbu6-shared";
import {
  planAutoImport,
  type AutoImportGroup,
  type FileRecognition,
  type PlannedFile,
} from "../bank-importer/auto-import-plan.js";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";
import {
  importOptionsFromPreset,
  readImportPresets,
  type ImportPreset,
} from "../bank-importer/import-presets.js";
import {
  runStatementImport,
  type StatementImportResult,
} from "../bank-importer/statement-import.js";
import {
  recognizeStatementFile,
  savedCustomStatementParserPaths,
} from "../bank-importer/statement-recognition.js";
import { respondWithImportErrors } from "./import-error-response.js";
import {
  filesFromField,
  uploadedFile,
  withTempUpload,
  withTempUploads,
} from "./upload-tmp.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Automatic statement import: the user uploads statement files, and
// optionally a Google Pay Takeout, and nothing else.
//
//   withTempUploads(statements)
//     -> per file: savedCustomStatementParserPaths(ext)
//                  recognizeStatementFile(candidates, path)
//     -> planAutoImport(recognitions, presets)   pure: groups, or a rejection
//     -> per group: runStatementImport(statements, importOptionsFromPreset)
//
// The Takeout names UPI recipients in every account the batch imports.
//
// Everything the account resolution decided is reported back, whether or not
// anything was imported, so the user can fix a preset and retry.

type AutoImportErrorBody = {
  error: string;
  message?: string;
  detail?: string;
  hint?: string;
  files?: AutoImportPlanFile[];
  failed_group?: AutoImportFailedGroup;
  imported_groups?: AutoImportGroupResult[];
  partial_import?: string;
} & Record<string, unknown>;

type AutoImportRouteResponse =
  | {
      status: 200;
      body: { files: AutoImportPlanFile[]; groups: AutoImportGroupResult[] };
    }
  | { status: 400; body: AutoImportErrorBody }
  | { status: 422; body: AutoImportErrorBody };

function planFileRow(file: PlannedFile): AutoImportPlanFile {
  switch (file.status) {
    case "resolved":
      return {
        status: "resolved",
        file_name: file.file,
        parser_path: file.parserPath,
        account: file.account,
        institution: file.institution,
        preset_name: file.presetName,
      };
    case "unrecognized":
      return {
        status: "unrecognized",
        file_name: file.file,
        candidate_parser_paths: file.candidateParserPaths,
      };
    case "ambiguous":
      return {
        status: "ambiguous",
        file_name: file.file,
        matching_parser_paths: file.matchingParserPaths,
      };
    case "unresolved":
      return {
        status: "unresolved",
        file_name: file.file,
        parser_path: file.parserPath,
        account: file.account,
        institution: file.institution,
        reason: file.reason,
        message: file.message,
        candidate_preset_names: file.candidatePresetNames,
      };
  }
}

function failedGroup(group: AutoImportGroup): AutoImportFailedGroup {
  return {
    preset_name: group.preset.name,
    base_account: group.preset.base_account,
    is_credit_card: group.preset.is_credit_card ?? false,
    file_names: group.statements.map((one) => one.file),
  };
}

function groupResult(
  group: AutoImportGroup,
  result: StatementImportResult,
): AutoImportGroupResult {
  return {
    preset_name: group.preset.name,
    base_account: group.preset.base_account,
    is_credit_card: group.preset.is_credit_card ?? false,
    file_names: group.statements.map((one) => one.file),
    result: {
      ...result,
      custom_statement_parser_paths: Array.from(
        new Set(group.statements.map((one) => one.parserPath)),
      ),
    },
  };
}

// Detection is per file so that one unreadable upload annotates its own row
// instead of ending the batch. `names` are what the user dropped; `paths` are
// the staged copies, in the same order.
async function recognizeUploads(
  names: readonly string[],
  paths: readonly string[],
): Promise<FileRecognition[]> {
  const recognitions: FileRecognition[] = [];
  for (const [index, inputPath] of paths.entries()) {
    const candidates = await savedCustomStatementParserPaths(
      path.extname(inputPath),
    );
    recognitions.push({
      ...(await recognizeStatementFile(candidates, inputPath)),
      file: names[index],
    });
  }
  return recognitions;
}

// Nothing is imported when any file is unrecognized, ambiguous, or unplaced by
// the presets: a partial import of a batch the user dropped as a unit is
// harder to undo than a retry.
function planRejection(files: AutoImportPlanFile[]): AutoImportRouteResponse {
  const unplaced = files.filter((file) => file.status !== "resolved").length;
  return {
    status: 422,
    body: {
      error: "auto_import_files_unresolved",
      message: `${unplaced} of ${files.length} uploaded file(s) could not be tied to an import preset, so nothing was imported.`,
      hint: "Remove those files, add a saved parser for a layout none recognised, or declare the account's preset in import-presets.json.",
      files,
    },
  };
}

// One preset is one account, so each group is one ordinary statement import.
// Groups run in sequence: a later failure leaves the earlier groups' drafts
// saved, which the response says outright, and names the group that failed.
async function importGroups(
  groups: readonly AutoImportGroup[],
  files: AutoImportPlanFile[],
  gpayHtmlPath: string | null,
  db: unknown,
  auth: RowScopeAuth,
): Promise<AutoImportRouteResponse> {
  const imported: AutoImportGroupResult[] = [];

  for (const group of groups) {
    const response = await respondWithImportErrors(() =>
      runStatementImport(
        group.statements.map((one) => one.statement),
        importOptionsFromPreset(group.preset, gpayHtmlPath),
        db,
        auth,
        group.statements.map((one) => one.file),
      ),
    );
    if (response.status !== 200) {
      const done = imported.map((one) => one.preset_name).join(", ");
      return {
        status: response.status,
        body: {
          ...response.body,
          files,
          failed_group: failedGroup(group),
          ...(imported.length === 0
            ? {}
            : {
                imported_groups: imported,
                partial_import: `${done} imported before "${group.preset.name}" failed. Those drafts are saved; drop their files before retrying.`,
              }),
        },
      };
    }
    imported.push(groupResult(group, response.body));
  }

  return { status: 200, body: { files, groups: imported } };
}

export interface AutoImportUploads {
  statements: File[];
  gpay: File | null;
}

export async function importStatementsAutomatically(
  uploads: AutoImportUploads,
  presets: readonly ImportPreset[],
  db: unknown,
  auth: RowScopeAuth,
): Promise<AutoImportRouteResponse> {
  const { statements, gpay } = uploads;
  const received = statements
    .map((file) => `${file.name} (${file.size}B)`)
    .join(", ");
  const takeout = gpay
    ? `; Google Pay takeout ${gpay.name} (${gpay.size}B)`
    : "";
  console.log(
    `[auto-statement-upload] received ${statements.length} file(s): ${received}${takeout}`,
  );

  if (gpay === null) return importStaged(statements, null, presets, db, auth);
  return withTempUpload(
    gpay,
    "gpay-auto-statement-upload",
    ".html",
    (gpayHtmlPath) => importStaged(statements, gpayHtmlPath, presets, db, auth),
  );
}

async function importStaged(
  statements: File[],
  gpayHtmlPath: string | null,
  presets: readonly ImportPreset[],
  db: unknown,
  auth: RowScopeAuth,
): Promise<AutoImportRouteResponse> {
  return withTempUploads(
    statements,
    "auto-statement-upload",
    async (_workDir, paths) => {
      const recognitions = await recognizeUploads(
        statements.map((file) => file.name),
        paths,
      );
      const plan = planAutoImport(recognitions, presets);
      const files = plan.files.map(planFileRow);
      if (!plan.ok) return planRejection(files);

      console.log(
        `[auto-statement-upload] importing ${plan.groups.length} account(s): ${plan.groups
          .map(
            (group) =>
              `${group.preset.name} <- ${group.statements.map((one) => one.file).join(", ")}`,
          )
          .join("; ")}`,
      );
      return importGroups(plan.groups, files, gpayHtmlPath, db, auth);
    },
  );
}

const api = new TsRestApi<SapportaEnv>();

api.register(
  "uploadStatementsAuto",
  importDraftsContract.uploadStatementsAuto,
  async ({ c, files: uploadedFiles }) => {
    const auth = requireWorkflowAuth(c);

    const statements = filesFromField(uploadedFiles, "files");
    if (statements.length === 0) {
      return {
        status: 400 as const,
        body: {
          error: "missing_multipart_field",
          message: "Missing 'files' field in multipart upload",
        },
      };
    }

    return importStatementsAutomatically(
      { statements, gpay: uploadedFile(uploadedFiles, "gpay") },
      await readImportPresets(),
      c.get("db"),
      auth,
    );
  },
);

export default api;
