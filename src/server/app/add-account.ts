import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { z } from "zod";
import {
  addAccountContract,
  addAccountFieldsSchema,
  promptedFiles,
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
import { NOT_RUNNING, progressBoard } from "./import-progress.js";
import {
  filesFromField,
  formFields,
  withStagedUploads,
  type ProjectFile,
  type StagedUploads,
} from "./upload-tmp.js";
import { requireWorkflowLedger } from "./workflow-auth.js";
import { inboxFilesFromField, deleteInboxFiles } from "./statement-inbox.js";
import { writeCommentsSoon } from "../workflows/comment-writer.js";

/*
 * Adding a bank or card from its statements (/add); the owner's only. The
 * dropped files are staged as /import stages them (`withStagedUploads`).
 * The read keeps only those its reply's card hands the user a coding-agent
 * prompt for (`promptedFiles`). The browser sends the files again with the
 * add, which reads them afresh and keeps nothing. A coding agent's run sends
 * files waiting in the statement inbox by path (`inbox_files`) instead: they
 * are read where they are, and an add deletes them from the inbox once their
 * rows are in the drafts. A read leaves them there.
 *
 * An add sent with a `progress_id` says how far it has got to
 * `addProgress` while it runs (import-progress.ts).
 */

export default function addAccountApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();
  const running = progressBoard();

  api.register(
    "readStatements",
    addAccountContract.readStatements,
    async ({ c, request, files }) => {
      const ledger = requireWorkflowLedger(c);
      const inbox = await inboxFilesFromField(request.body);
      if ("notInInbox" in inbox) return notInInbox(inbox.notInInbox);
      const statements = [...filesFromField(files, "files"), ...inbox.files];
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
        // Kept only for the card's coding-agent prompt (`promptedFiles`).
        const prompted = promptedFiles({ files: reading.files, accounts });
        if (prompted !== null) staged.keep(prompted);
        const body: AddAccountReading = {
          files: reading.files.map((file, index) =>
            prompted?.includes(index) && file.status === "read"
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
      const inbox = await inboxFilesFromField(request.body);
      if ("notInInbox" in inbox) return notInInbox(inbox.notInInbox);
      const statements = [...filesFromField(files, "files"), ...inbox.files];
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
      const tracked = running.start(formFields(request.body).progress_id);
      try {
        return await withStagedUploads(statements, async (staged) => {
          const done = await addAccount(
            ledger,
            loadCategorizer,
            dropped(statements, staged),
            fields.data,
            tracked?.onProgress,
          );
          // The new drafts' comments, in the background.
          writeCommentsSoon();
          if (!done.ok) return addRefusal(done);
          if (inbox.files.length === 0) {
            return { status: 200 as const, body: done.added };
          }
          return {
            status: 200 as const,
            body: {
              ...done.added,
              inbox_files_imported: await deleteInboxFiles(inbox.files),
            },
          };
        });
      } finally {
        tracked?.finish();
      }
    },
  );

  api.register(
    "addProgress",
    addAccountContract.addProgress,
    async ({ c, request }) => {
      requireWorkflowLedger(c);
      const progress = running.read(request.params.progressId);
      if (progress === undefined) return NOT_RUNNING;
      return { status: 200 as const, body: progress };
    },
  );

  return api;
}

function missingFiles() {
  return {
    status: 400 as const,
    body: {
      error:
        "Drop the statements as `files`, or name ones in the statement inbox as `inbox_files`.",
      code: "missing_multipart_field" as const,
    },
  };
}

function notInInbox(error: string) {
  return {
    status: 400 as const,
    body: { error, code: "not_in_inbox" as const },
  };
}

// The dropped files as they were staged, in the order they came.
function dropped(
  files: readonly (File | ProjectFile)[],
  staged: StagedUploads,
) {
  return files.map((file, index): DroppedStatement => ({
    fileName: file.name,
    path: staged.paths[index],
    projectPath: staged.projectPaths[index],
  }));
}

// What the request brought is a 400, the rest a 422. The files are never
// kept: the screen reads them again, and that read keeps what its card needs.
function addRefusal(
  refusal: Extract<AddAccountOutcome, { ok: false }>,
):
  | { status: 400; body: AddAccountRefusal }
  | { status: 422; body: AddAccountRefusal } {
  const body: AddAccountRefusal = {
    error: refusal.error,
    code: refusal.code,
    ...(refusal.importError === undefined
      ? {}
      : { import_error: importErrorResponse(refusal.importError).body }),
  };
  return refusal.code === "missing_multipart_field" ||
    refusal.code === "invalid_fields"
    ? { status: 400, body }
    : { status: 422, body };
}
