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

// One file of the export. `path` is relative to main.journal, which comes
// first and includes the rest; `transaction_count` is 0 for main.journal.
export const hledgerExportFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  transaction_count: z.number().int(),
});
export type HledgerExportFile = z.infer<typeof hledgerExportFileSchema>;

export const hledgerExportContract = c.router({
  exportHledger: c.query({
    method: "GET",
    path: "/export/hledger",
    summary:
      "The books as hledger journal files: main.journal, one file per statement account, and the journals outside them",
    responses: {
      200: z.object({
        files: z.array(hledgerExportFileSchema),
        journal_count: z.number().int(),
      }),
      403: errorSchema,
    },
  }),
});
