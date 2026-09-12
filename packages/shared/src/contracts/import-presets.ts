import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { statementAccountIdentifierSchema } from "./statement-account.js";

const c = initContract();

export const importPresetSchema = z.object({
  name: z.string().min(1),
  base_account: z.string().min(1),
  custom_mappings_filenames: z.array(z.string()),
  is_credit_card: z.boolean().optional(),
  custom_statement_parser_path: z.string().min(1).optional(),
  // The account or card number the preset's statements print, in the
  // canonical form of `statementAccountSchema`. Lets several presets share
  // one parser (two cards from the same bank) and lets the importer refuse a
  // statement that names a different account.
  statement_account_identifier: statementAccountIdentifierSchema.optional(),
});
export type ImportPreset = z.infer<typeof importPresetSchema>;

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
