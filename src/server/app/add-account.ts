import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { z } from "zod";
import {
  addAccountContract,
  addAccountFieldsSchema,
  addProgressIdSchema,
  promptedFiles,
  type AddAccountReading,
  type AddAccountRefusal,
  type AddProgress,
} from "../../shared/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import {
  addAccount,
  readStatements,
  type AddAccountOutcome,
  type DroppedStatement,
} from "../workflows/add-account.js";
import type { ImportProgress } from "../workflows/statement-import/index.js";
import { importErrorResponse } from "./import-error-response.js";
import {
  filesFromField,
  withStagedUploads,
  type StagedUploads,
} from "./upload-tmp.js";
import { requireWorkflowLedger } from "./workflow-auth.js";
import { writeCommentsSoon } from "../workflows/comment-writer.js";

/*
 * Adding a bank or card from its statements (/add); the owner's only. The
 * dropped files are staged as /import stages them (`withStagedUploads`).
 * The read keeps only those its reply's card hands the user a coding-agent
 * prompt for (`promptedFiles`). The browser sends the files again with the
 * add, which reads them afresh and keeps nothing.
 *
 * An add sent with a `progress_id` says how far it has got to
 * `addProgress` while it runs; that is held in memory, and only until the
 * add answers.
 */

export default function addAccountApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();
  const running = new Map<string, AddProgress>();

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
      const progressId = addProgressIdSchema.safeParse(
        formFields(request.body).progress_id,
      );
      const id = progressId.success ? progressId.data : null;
      if (id !== null) running.set(id, STARTED);
      try {
        return await withStagedUploads(statements, async (staged) => {
          const done = await addAccount(
            ledger,
            loadCategorizer,
            dropped(statements, staged),
            fields.data,
            id === null
              ? undefined
              : (event) =>
                  running.set(id, nextProgress(running.get(id), event)),
          );
          // The new drafts' comments, in the background.
          writeCommentsSoon();
          if (done.ok) return { status: 200 as const, body: done.added };
          return addRefusal(done);
        });
      } finally {
        if (id !== null) running.delete(id);
      }
    },
  );

  api.register(
    "addProgress",
    addAccountContract.addProgress,
    async ({ c, request }) => {
      requireWorkflowLedger(c);
      const progress = running.get(request.params.progressId);
      if (progress === undefined) {
        return {
          status: 404 as const,
          body: { error: "No add is running under that id." },
        };
      }
      return { status: 200 as const, body: progress };
    },
  );

  return api;
}

const STARTED: AddProgress = { stage: "account", rules: null, llm: null };

// Pure: a running add's progress, with the import's latest word on it.
export function nextProgress(
  progress: AddProgress = STARTED,
  event: ImportProgress,
): AddProgress {
  switch (event.stage) {
    case "rules":
      return {
        stage: "rules",
        rules: { transactions: event.transactions, matched: event.matched },
        llm: null,
      };
    case "llm":
      return {
        ...progress,
        stage: "llm",
        llm: { descriptions: event.descriptions, answered: event.answered },
      };
    case "saving":
      return { ...progress, stage: "saving" };
  }
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
