import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

export const extractionToolSchema = z.enum(["extract-table", "pdftotext"]);
export type ExtractionTool = z.infer<typeof extractionToolSchema>;

export const importPresetSchema = z.object({
  name: z.string().min(1),
  base_account: z.string().min(1),
  custom_mappings_filenames: z.array(z.string()),
  is_credit_card: z.boolean().optional(),
  extraction_tool: extractionToolSchema.optional(),
  custom_statement_parser_path: z.string().min(1).optional(),
});

export const importPresetsContract = c.router({
  listImportPresets: c.query({
    method: "GET",
    path: "/import-presets",
    summary: "List configured import presets",
    responses: {
      200: z.array(importPresetSchema),
      403: z.object({ error: z.string() }),
    },
  }),
});
