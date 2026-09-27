import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z.object({ error: z.string() }).passthrough();

/*
 * The comment writer (server workflows/comment-writer.ts), which fills each
 * imported row's comment from its source narration in the background.
 */

// `pending` and `failed` count distinct texts still without a comment:
// `failed` are those the writer gave up on after three failed answers.
// `last_error` says why the last run stopped with the engine unusable, such
// as a coding agent that isn't answering; null once a call succeeds.
export const commentWriterStatusSchema = z.object({
  running: z.boolean(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
});
export type CommentWriterStatus = z.infer<typeof commentWriterStatusSchema>;

export const commentWriterContract = c.router({
  getCommentWriterStatus: c.query({
    method: "GET",
    path: "/comment-writer/status",
    summary: "Whether the comment writer is running, and what it has left",
    responses: {
      200: commentWriterStatusSchema,
      403: errorSchema,
    },
  }),
  retryCommentWriter: c.mutation({
    method: "POST",
    path: "/comment-writer/run",
    summary:
      "Forget the comments the writer gave up on, and run it again; answers its status",
    body: z.object({}),
    responses: {
      200: commentWriterStatusSchema,
      403: errorSchema,
    },
  }),
});
