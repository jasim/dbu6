import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  guideCommand,
  importDraftsContract,
  type ImportInstitution,
  type AutoImportErrorBody,
  type AutoImportFailedGroup,
  type AutoImportGroupResult,
  type AutoImportPlanFile,
} from "../../shared/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import type {
  AutoImportGroup,
  PlannedFile,
} from "../modules/statement-sources/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  importStatementBatch,
  type BatchImportOutcome,
  type ImportedGroup,
} from "../workflows/statement-import/index.js";
import { importErrorResponse } from "./import-error-response.js";
import {
  filesFromField,
  uploadedFile,
  withStagedUploads,
  withTempUpload,
  type StagedUploads,
} from "./upload-tmp.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

// Automatic statement import: the user uploads statement files, and
// optionally a Google Pay Takeout, and nothing else.
//
//   withTempUpload(gpay), withStagedUploads(statements)
//     -> importStatementBatch: recognize, plan, import group by group
//     -> the reply, built from the batch's outcome
//
// Everything the account resolution decided is reported back, whether or not
// anything was imported, so the user can fix the presets and retry.
//
// The uploads are staged inside the project (tmp/statement-uploads/), and a
// batch that did not import keeps them: every file the reply reports says
// where its copy is, which is what the screen's prompts hand to a coding
// agent instead of asking the user to find the file again.

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
        parser_path: file.parserName,
        account: file.account,
        institution: file.institution,
        account_id: file.accountId,
        account_name: file.accountName,
      };
    case "unrecognized":
      return {
        status: "unrecognized",
        file_name: file.file,
        saved_path: savedPath,
        candidate_parser_paths: file.candidateParserNames,
      };
    case "ambiguous":
      return {
        status: "ambiguous",
        file_name: file.file,
        saved_path: savedPath,
        matching_parser_paths: file.matchingParserNames,
      };
    case "unresolved":
      return {
        status: "unresolved",
        file_name: file.file,
        saved_path: savedPath,
        parser_path: file.parserName,
        account: file.account,
        institution: file.institution,
        reason: file.reason,
        message: file.message,
        institution_name: file.institutionName,
        candidate_account_names: file.candidateAccountNames,
      };
  }
}

function failedGroup(
  group: AutoImportGroup,
  baseAccount: string,
): AutoImportFailedGroup {
  return {
    account_id: group.account.account_id,
    account_name: group.account.name,
    base_account: baseAccount,
    is_credit_card: accountKindOf(group.account.is_credit_card) === "card",
    file_names: group.statements.map((one) => one.file),
  };
}

function groupResult({
  group,
  baseAccount,
  result,
}: ImportedGroup): AutoImportGroupResult {
  return {
    account_id: group.account.account_id,
    account_name: group.account.name,
    base_account: baseAccount,
    is_credit_card: accountKindOf(group.account.is_credit_card) === "card",
    file_names: group.statements.map((one) => one.file),
    result: {
      ...result,
      custom_statement_parser_paths: Array.from(
        new Set(group.statements.map((one) => one.parserName)),
      ),
    },
  };
}

// The reply for a batch's outcome. `savedPath` says where a file's staged copy
// is, by the name it was uploaded under.
function batchResponse(
  outcome: BatchImportOutcome,
  savedPath: (fileName: string) => string | null,
): AutoImportRouteResponse {
  const files = outcome.files.map((file) =>
    planFileRow(file, savedPath(file.file)),
  );
  switch (outcome.kind) {
    case "unplanned": {
      const unplaced = files.filter(
        (file) => file.status !== "resolved",
      ).length;
      return {
        status: 422,
        body: {
          error: "auto_import_files_unresolved",
          message: `${unplaced} of ${files.length} uploaded file(s) could not be tied to an import preset's account, so nothing was imported.`,
          hint: `Remove those files, add a saved parser for a layout none recognised, or add the parser, account or identifier to the import presets with the calls \`${guideCommand("books")}\` describes.`,
          files,
        },
      };
    }
    case "failed": {
      // The failing group keeps the import error's own payload and status,
      // and the reply says outright which groups' drafts are already saved.
      const { status, body } = importErrorResponse(outcome.error);
      const imported = outcome.imported.map(groupResult);
      const done = imported.map((one) => one.account_name).join(", ");
      return {
        status,
        body: {
          ...body,
          files,
          failed_group: failedGroup(outcome.failed, outcome.failedBaseAccount),
          ...(imported.length === 0
            ? {}
            : {
                imported_groups: imported,
                partial_import: `${done} imported before "${outcome.failed.account.name}" failed. Those drafts are saved; drop their files before retrying.`,
              }),
        },
      };
    }
    case "imported":
      return {
        status: 200,
        body: { files, groups: outcome.imported.map(groupResult) },
      };
  }
}

export interface AutoImportUploads {
  statements: File[];
  gpay: File | null;
}

export async function importStatementsAutomatically(
  uploads: AutoImportUploads,
  institutions: readonly ImportInstitution[],
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
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

  const importWith = (gpayHtmlPath: string | null) =>
    importStaged(
      statements,
      gpayHtmlPath,
      institutions,
      ledger,
      loadCategorizer,
    );
  if (gpay === null) return importWith(null);
  return withTempUpload(
    gpay,
    "gpay-auto-statement-upload",
    ".html",
    importWith,
  );
}

async function importStaged(
  statements: File[],
  gpayHtmlPath: string | null,
  institutions: readonly ImportInstitution[],
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
): Promise<AutoImportRouteResponse> {
  return withStagedUploads(statements, async (staged) => {
    const outcome = await importStatementBatch(
      {
        statements: statements.map((file, index) => ({
          name: file.name,
          path: staged.paths[index],
        })),
        gpayHtmlPath,
        institutions,
      },
      ledger,
      loadCategorizer,
    );
    // The outcome keys a file by the name it was uploaded under, which is how
    // its staged copy is found again.
    const stagedAt = new Map(
      statements.map((file, index) => [file.name, staged.projectPaths[index]]),
    );
    return keepUploadsFor(
      batchResponse(outcome, (name) => stagedAt.get(name) ?? null),
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

export default function importDraftStatementsAutoApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();

  api.register(
    "uploadStatementsAuto",
    importDraftsContract.uploadStatementsAuto,
    async ({ c, files: uploadedFiles }) => {
      const ledger = requireWorkflowLedger(c);

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
        loadImportPresets(ledger.db, ledger.auth),
        ledger,
        loadCategorizer,
      );
    },
  );

  return api;
}
