import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { z } from "zod";
import {
  addAccountContract,
  addAccountFieldsSchema,
  refusalPromptsAgent,
  type AddAccountReading,
  type AddAccountRefusal,
} from "../../shared/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import {
  addAccount,
  readStatements,
  type AddAccountOutcome,
  type DroppedStatement,
} from "../workflows/add-account.js";
import { importErrorResponse } from "./import-error-response.js";
import {
  filesFromField,
  withStagedUploads,
  type StagedUploads,
} from "./upload-tmp.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

/*
 * Adding a bank or card from its statements (/add); the owner's only. The
 * dropped files are staged as /import stages them (`withStagedUploads`),
 * and kept only when the reply hands the user a coding-agent prompt that
 * points at them: a file no parser reads or several do, or a refusal
 * /import gives a prompt for (`refusalPromptsAgent`). The browser sends the
 * files again with the add, which reads them afresh.
 */

export default function addAccountApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();

  api.register(
    "readStatements",
    addAccountContract.readStatements,
    async ({ c, files }) => {
      const ledger = requireWorkflowLedger(c);
      const statements = filesFromField(files, "files");
      if (statements.length === 0) return missingFiles();
      return withStagedUploads(statements, async (staged) => {
        const reading = await readStatements(
          ledger,
          dropped(statements, staged),
        );
        const accounts = reading.accounts.map((account) => ({
          ...account,
          refusal: account.refusal && importErrorResponse(account.refusal).body,
        }));
        const keep =
          reading.files.some((file) => file.status !== "read") ||
          accounts.some(
            (account) =>
              account.refusal !== null && refusalPromptsAgent(account.refusal),
          );
        if (keep) staged.keep();
        const body: AddAccountReading = {
          files: reading.files.map((file, index) =>
            keep && file.status === "read"
              ? { ...file, saved_path: staged.projectPaths[index] }
              : file,
          ),
          accounts,
          categorizer: reading.categorizer,
        };
        return { status: 200 as const, body };
      });
    },
  );

  // One headless import, categorization included, as long as /import's.
  api.register(
    "addAccount",
    addAccountContract.addAccount,
    async ({ c, request, files }) => {
      const ledger = requireWorkflowLedger(c);
      const statements = filesFromField(files, "files");
      if (statements.length === 0) return missingFiles();
      const fields = addAccountFieldsSchema.safeParse(formFields(request.body));
      if (!fields.success) {
        return {
          status: 400 as const,
          body: {
            error: z.prettifyError(fields.error),
            code: "invalid_fields" as const,
          },
        };
      }
      return withStagedUploads(statements, async (staged) => {
        const done = await addAccount(
          ledger,
          loadCategorizer,
          dropped(statements, staged),
          fields.data,
        );
        if (done.ok) return { status: 200 as const, body: done.added };
        return addRefusal(done, statements, staged);
      });
    },
  );

  return api;
}

function missingFiles() {
  return {
    status: 400 as const,
    body: {
      error: "Drop the statements as `files`.",
      code: "missing_multipart_field" as const,
    },
  };
}

// The dropped files as they were staged, in the order they came.
function dropped(files: readonly File[], staged: StagedUploads) {
  return files.map((file, index): DroppedStatement => ({
    name: file.name,
    path: staged.paths[index],
    projectPath: staged.projectPaths[index],
  }));
}

// The multipart body's text fields. One left empty is one not sent.
function formFields(body: unknown): Record<string, string> {
  if (body === null || typeof body !== "object") return {};
  return Object.fromEntries(
    Object.entries(body).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1] !== "",
    ),
  );
}

// What the request brought is a 400, the rest a 422. An import refusal
// /import gives a prompt for keeps the files, and says where.
function addRefusal(
  refusal: Extract<AddAccountOutcome, { ok: false }>,
  files: readonly File[],
  staged: StagedUploads,
):
  | { status: 400; body: AddAccountRefusal }
  | { status: 422; body: AddAccountRefusal } {
  const importError =
    refusal.importError && importErrorResponse(refusal.importError).body;
  const keep = importError !== undefined && refusalPromptsAgent(importError);
  if (keep) staged.keep();
  const body: AddAccountRefusal = {
    error: refusal.error,
    code: refusal.code,
    ...(importError === undefined ? {} : { import_error: importError }),
    ...(keep
      ? {
          files: files.map((file, index) => ({
            file_name: file.name,
            saved_path: staged.projectPaths[index],
          })),
        }
      : {}),
  };
  return refusal.code === "missing_multipart_field" ||
    refusal.code === "invalid_fields"
    ? { status: 400, body }
    : { status: 422, body };
}
