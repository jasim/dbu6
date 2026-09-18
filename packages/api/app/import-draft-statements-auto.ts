import path from "node:path";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  importDraftsContract,
  type AutoImportErrorBody,
  type AutoImportFailedGroup,
  type AutoImportGroupResult,
  type AutoImportPlanFile,
} from "dbu6-shared";
import {
  planAutoImport,
  type AutoImportGroup,
  type FileRecognition,
  type PlannedFile,
  readImportPresets,
  type ImportPreset,
  recognizeStatementFile,
  savedCustomStatementParserPaths,
} from "../modules/statement-sources/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import {
  importOptionsFromPreset,
  runStatementImport,
  type StatementImportResult,
} from "../bank-importer/statement-import.js";
import { categorizationLlm } from "../coding-agent/categorization-llm.js";
import { respondWithImportErrors } from "./import-error-response.js";
import {
  filesFromField,
  uploadedFile,
  withStagedUploads,
  withTempUpload,
  type StagedUploads,
} from "./upload-tmp.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Automatic statement import: the user uploads statement files, and
// optionally a Google Pay Takeout, and nothing else.
//
//   withStagedUploads(statements)
//     -> per file: savedCustomStatementParserPaths(ext)
//                  recognizeStatementFile(candidates, path)
//     -> planAutoImport(recognitions, presets)   pure: groups, or a rejection
//     -> per group: runStatementImport(statements, importOptionsFromPreset)
//
// The Takeout names UPI recipients in every account the batch imports.
//
// Everything the account resolution decided is reported back, whether or not
// anything was imported, so the user can fix a preset and retry.
//
// The uploads are staged inside the project (tmp/statement-uploads/), and a
// batch that did not import keeps them: every file the reply reports says
// where its copy is, which is what the screen's prompts hand to a coding
// agent instead of asking the user to find the file again.

// Where a batch is staged, under the project's own tmp/.
const STAGED_UPLOADS_DIR = "statement-uploads";

type AutoImportRouteResponse =
  | {
      status: 200;
      body: { files: AutoImportPlanFile[]; groups: AutoImportGroupResult[] };
    }
  | { status: 400; body: AutoImportErrorBody }
  | { status: 422; body: AutoImportErrorBody };

function planFileRow(
  file: PlannedFile,
  savedPath: string | null,
): AutoImportPlanFile {
  switch (file.status) {
    case "resolved":
      return {
        status: "resolved",
        file_name: file.file,
        saved_path: savedPath,
        parser_path: file.parserPath,
        account: file.account,
        institution: file.institution,
        preset_name: file.presetName,
      };
    case "unrecognized":
      return {
        status: "unrecognized",
        file_name: file.file,
        saved_path: savedPath,
        candidate_parser_paths: file.candidateParserPaths,
      };
    case "ambiguous":
      return {
        status: "ambiguous",
        file_name: file.file,
        saved_path: savedPath,
        matching_parser_paths: file.matchingParserPaths,
      };
    case "unresolved":
      return {
        status: "unresolved",
        file_name: file.file,
        saved_path: savedPath,
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
    is_credit_card: accountKindOf(group.preset.is_credit_card) === "card",
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
    is_credit_card: accountKindOf(group.preset.is_credit_card) === "card",
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
  auth: LedgerAuth,
): Promise<AutoImportRouteResponse> {
  const imported: AutoImportGroupResult[] = [];
  // One engine for the batch: every group categorizes on the same agent.
  const llm = await categorizationLlm();

  for (const group of groups) {
    const response = await respondWithImportErrors(() =>
      runStatementImport(
        group.statements.map((one) => one.statement),
        importOptionsFromPreset(group.preset, gpayHtmlPath, llm),
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
  auth: LedgerAuth,
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
  auth: LedgerAuth,
): Promise<AutoImportRouteResponse> {
  return withStagedUploads(statements, STAGED_UPLOADS_DIR, async (staged) => {
    const names = statements.map((file) => file.name);
    const recognitions = await recognizeUploads(names, staged.paths);
    const plan = planAutoImport(recognitions, presets);
    // The plan keys a file by the name it was uploaded under, which is how
    // its staged copy is found again.
    const stagedAt = new Map(
      names.map((name, index) => [name, staged.projectPaths[index]]),
    );
    const files = plan.files.map((file) =>
      planFileRow(file, stagedAt.get(file.file) ?? null),
    );
    if (!plan.ok) return keepUploadsFor(planRejection(files), staged);

    console.log(
      `[auto-statement-upload] importing ${plan.groups.length} account(s): ${plan.groups
        .map(
          (group) =>
            `${group.preset.name} <- ${group.statements.map((one) => one.file).join(", ")}`,
        )
        .join("; ")}`,
    );
    return keepUploadsFor(
      await importGroups(plan.groups, files, gpayHtmlPath, db, auth),
      staged,
    );
  });
}

// The staged copies exist for the prompts the screen offers when something
// went wrong, so a batch that imported keeps none: its files go with the work
// directory, and its reply points at nothing.
function keepUploadsFor(
  response: AutoImportRouteResponse,
  staged: StagedUploads,
): AutoImportRouteResponse {
  if (response.status !== 200) {
    staged.keep();
    return response;
  }
  return {
    status: 200,
    body: {
      files: response.body.files.map((file) => ({ ...file, saved_path: null })),
      groups: response.body.groups,
    },
  };
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
          error: "missing_multipart_field" as const,
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
