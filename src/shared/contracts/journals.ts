import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    detail: z.string().optional(),
    hint: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();

export const journalsContract = c.router({
  renderHledger: c.mutation({
    method: "POST",
    path: "/journals/hledger",
    summary: "Render selected journals as hledger journal text",
    body: z.object({
      journal_ids: z.array(z.number().int().positive()),
    }),
    responses: {
      200: z.object({
        hledger_journal: z.string(),
        journal_count: z.number(),
      }),
      403: errorSchema,
    },
  }),
});
