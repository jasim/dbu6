import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z.object({ error: z.string() }).passthrough();

/*
 * The statement inbox: statements the user drops for a run of their coding
 * agent (`npx dbu6 docs run`), saved under the project's
 * tmp/statement-inbox/<batch>/ and nothing more. Nothing reads or imports
 * them until the agent sends them to an import by `saved_path`
 * (`inbox_files`). The import deletes each from the inbox once its rows are
 * in the drafts, so what waits there is what hasn't gone in. Discarding a
 * file deletes it unimported.
 */

export const statementInboxFileSchema = z.object({
  /** The name the file was dropped with. */
  file_name: z.string(),
  /** Where it is saved, relative to the project root. */
  saved_path: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type StatementInboxFile = z.infer<typeof statementInboxFileSchema>;

export const statementInboxBatchSchema = z.object({
  /** The batch's folder name: the time it was dropped, and a few hex digits. */
  batch: z.string(),
  files: z.array(statementInboxFileSchema),
});
export type StatementInboxBatch = z.infer<typeof statementInboxBatchSchema>;

/**
 * A drop, saved: the batch of the files new to the inbox (none when every
 * file was already there), and the names of those skipped because a file
 * with the same contents waits already, or came earlier in the same drop.
 */
export const statementInboxDropSchema = statementInboxBatchSchema.extend({
  already_uploaded: z.array(z.string()),
});
export type StatementInboxDrop = z.infer<typeof statementInboxDropSchema>;

export const statementInboxContract = c.router({
  listStatementInbox: c.query({
    method: "GET",
    path: "/statement-inbox",
    summary:
      "The batches of statements waiting in the inbox for a run (`npx dbu6 docs run`), oldest first, each with its files. Send a file to /add-account/read, /add-account/add or /import-draft/statements/auto as `inbox_files=<saved_path>` (or to /import-draft/abacus in `inbox_files`, for rows read from it); an import deletes it from the inbox once its rows are in the drafts, and a read leaves it",
    responses: {
      200: z.object({ batches: z.array(statementInboxBatchSchema) }),
      403: errorSchema,
    },
  }),
  saveToStatementInbox: c.mutation({
    method: "POST",
    path: "/statement-inbox",
    summary:
      "Save dropped statements (`files`, repeated) as one batch under tmp/statement-inbox/<batch>/ for a run. A file whose contents are already in the inbox is skipped and named in `already_uploaded`. Nothing is read, parsed or written to the books",
    contentType: "multipart/form-data",
    body: z.any(),
    responses: {
      200: statementInboxDropSchema,
      400: errorSchema,
      403: errorSchema,
    },
  }),
  discardFromStatementInbox: c.mutation({
    method: "POST",
    path: "/statement-inbox/discard",
    summary:
      "Discard one dropped statement the person doesn't want imported, by its `saved_path`: it is deleted from the inbox unimported. An import deletes its own inbox files, so a file that went in never needs this",
    body: z.object({ saved_path: z.string() }),
    responses: {
      200: z.object({ discarded: z.string() }),
      403: errorSchema,
      404: errorSchema,
    },
  }),
  discardStatementInbox: c.mutation({
    method: "POST",
    path: "/statement-inbox/discard-all",
    summary:
      "Discard every dropped statement, every batch with it: all are deleted from the inbox unimported. `discarded` is how many files went",
    body: z.object({}),
    responses: {
      200: z.object({ discarded: z.number().int().nonnegative() }),
      403: errorSchema,
    },
  }),
});
