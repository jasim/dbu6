import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z.object({ error: z.string() }).passthrough();

/*
 * Lessons for the categoriser, taught on Review's Improve categorization tab
 * (schema/categorization-lessons.ts), where the user calls them new rules.
 * The user's coding agent turns each into a rule or guidance, and then
 * deletes it; the categorizer then gives the drafts their category.
 */

export const categorizationLessonSchema = z.object({
  id: z.number().int(),
  // The statement account the drafts were imported for.
  base_account_id: z.number().int(),
  // Where the user said the drafts go.
  account: z.object({ id: z.number().int(), name: z.string() }),
  narrations: z.array(z.string()).min(1),
  // What the user added for next time, or "".
  note: z.string(),
});
export type CategorizationLesson = z.infer<typeof categorizationLessonSchema>;

export const categorizationLessonsContract = c.router({
  listCategorizationLessons: c.query({
    method: "GET",
    path: "/categorization-lessons",
    summary: "The lessons waiting to be taught, for one statement account",
    query: z.object({
      base_account_id: z.coerce.number().int().positive(),
    }),
    responses: {
      200: z.object({ lessons: z.array(categorizationLessonSchema) }),
      403: errorSchema,
    },
  }),
  teachCategorization: c.mutation({
    method: "POST",
    path: "/categorization-lessons",
    summary:
      "Record that drafts of one statement account go to an account, as a lesson for the coding agent; the drafts keep no category",
    body: z.object({
      draft_ids: z.array(z.number().int().positive()).min(1),
      account_id: z.number().int().positive(),
      note: z.string().default(""),
    }),
    responses: {
      200: z.object({ lesson: categorizationLessonSchema }),
      403: errorSchema,
      // The account, or one of the drafts, isn't in the books.
      404: errorSchema,
      // The account is the drafts' own statement account, or the drafts
      // belong to more than one.
      422: errorSchema,
    },
  }),
  deleteCategorizationLesson: c.mutation({
    method: "DELETE",
    path: "/categorization-lessons/:id",
    summary:
      "Delete a lesson once it is taught, or when the user no longer wants it",
    pathParams: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({}).optional(),
    responses: {
      200: z.object({ deleted: z.number() }),
      403: errorSchema,
      404: errorSchema,
    },
  }),
  clearCategorizationLessons: c.mutation({
    method: "DELETE",
    path: "/categorization-lessons",
    summary: "Delete every lesson of one statement account",
    query: z.object({
      base_account_id: z.coerce.number().int().positive(),
    }),
    body: z.object({}).optional(),
    responses: {
      200: z.object({ deleted: z.number() }),
      403: errorSchema,
    },
  }),
});
