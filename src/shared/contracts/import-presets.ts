import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { statementAccountIdentifierSchema } from "./statement-account.js";

const c = initContract();

export const importPresetSchema = z.object({
  name: z.string().min(1),
  base_account: z.string().min(1),
  custom_mappings_filenames: z.array(z.string()),
  is_credit_card: z.boolean().optional(),
  // The saved parser's directory name alone, e.g. `hdfc-bank-xls`. The
  // project's custom-built-parsers/ is searched before the parsers bundled
  // with dbu6, so the user's parser shadows ours of the same name.
  custom_statement_parser_path: z
    .string()
    .regex(
      /^[^/\\.][^/\\]*$/,
      "Name the parser by its directory name alone, such as hdfc-bank-xls, not by a path.",
    )
    .optional(),
  // The account or card number the preset's statements print, in the
  // canonical form of `statementAccountSchema`. Lets several presets share
  // one parser (two cards from the same bank) and lets the importer refuse a
  // statement that names a different account.
  statement_account_identifier: statementAccountIdentifierSchema.optional(),
});
export type ImportPreset = z.infer<typeof importPresetSchema>;

// A name that is one entry of a directory, never a path: a saved parser's
// directory, or a file directly in user-config/.
const DIRECTORY_ENTRY_RE = /^[^/\\.][^/\\]*$/;

// A saved parser's directory name alone, e.g. `hdfc-bank-xls`. The project's
// custom-built-parsers/ is searched before the parsers bundled with dbu6, so
// the user's parser shadows ours of the same name.
export const parserNameSchema = z
  .string()
  .regex(
    DIRECTORY_ENTRY_RE,
    "Name the parser by its directory name alone, such as hdfc-bank-xls, not by a path.",
  );

// A `custom_mappings_*.prompt` file directly in user-config/, never a path.
export const mappingFilenameSchema = z
  .string()
  .regex(DIRECTORY_ENTRY_RE, "Name a file in user-config/, not a path.");

/*
 * Import presets: one institution per row of `import_presets`. An institution
 * lists the saved parsers that read its statements and the ledger accounts
 * those statements import into. Every write goes through
 * `POST /import-presets/changes`, which checks the whole table
 * (`validateImportPresets` in statement-sources).
 */

// One ledger account an institution's statements import into.
export const importAccountSchema = z.object({
  // The ledger's accounts.id. It may dangle once the account is deleted, and
  // the importer then refuses to import into it.
  account_id: z.number().int().positive(),
  // What everyday screens call the account.
  name: z.string(),
  is_credit_card: z.boolean(),
  // Each way the account's statements print its number, in the canonical
  // form of `statementAccountSchema`.
  account_identifiers: z.array(statementAccountIdentifierSchema),
  // The account's instructions for the LLM, joined in this order.
  custom_mappings_filenames: z.array(mappingFilenameSchema),
});
export type ImportAccount = z.infer<typeof importAccountSchema>;

export const importInstitutionSchema = z.object({
  id: z.number().int(),
  // "Sample Bank"; unique in a user's presets.
  name: z.string(),
  // Saved parser directory names. A parser belongs to the institution that
  // lists it; the institution a parser prints is never matched.
  parsers: z.array(parserNameSchema),
  accounts: z.array(importAccountSchema),
});
export type ImportInstitution = z.infer<typeof importInstitutionSchema>;

// An account as the presets endpoints return it: with the ledger account's
// current name, or null when its id dangles.
export const importAccountViewSchema = importAccountSchema.extend({
  ledger_account_name: z.string().nullable(),
});
export type ImportAccountView = z.infer<typeof importAccountViewSchema>;

export const importPresetsViewSchema = z.object({
  institutions: z.array(
    importInstitutionSchema.extend({
      accounts: z.array(importAccountViewSchema),
    }),
  ),
});
export type ImportPresetsView = z.infer<typeof importPresetsViewSchema>;

// One change to the presets. Institutions are named by `name`, accounts by
// `account_id`. A batch is applied in order and written whole or not at all.
export const importPresetChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_institution"),
    name: z.string(),
    parsers: z.array(parserNameSchema),
  }),
  z.object({
    kind: z.literal("rename_institution"),
    institution: z.string(),
    new_name: z.string(),
  }),
  // Refused while the institution has accounts.
  z.object({ kind: z.literal("remove_institution"), institution: z.string() }),
  z.object({
    kind: z.literal("add_parser"),
    institution: z.string(),
    parser: parserNameSchema,
  }),
  z.object({
    kind: z.literal("remove_parser"),
    institution: z.string(),
    parser: parserNameSchema,
  }),
  importAccountSchema.extend({
    kind: z.literal("add_account"),
    institution: z.string(),
  }),
  // Each list given replaces the account's whole list, so reordering the
  // instruction files is sending them in the new order.
  z.object({
    kind: z.literal("update_account"),
    account_id: z.number().int().positive(),
    name: z.string().optional(),
    is_credit_card: z.boolean().optional(),
    account_identifiers: z.array(statementAccountIdentifierSchema).optional(),
    custom_mappings_filenames: z.array(mappingFilenameSchema).optional(),
  }),
  z.object({
    kind: z.literal("remove_account"),
    account_id: z.number().int().positive(),
  }),
]);
export type ImportPresetChange = z.infer<typeof importPresetChangeSchema>;

// Why a batch of changes was refused.
export const importPresetRefusalCodeSchema = z.enum([
  // A change names what the presets don't hold, or can't be applied.
  "unknown_institution",
  "unknown_account",
  "parser_not_listed",
  "institution_has_accounts",
  // The rules over the whole table.
  "institution_name_empty",
  "institution_name_taken",
  "parser_listed_twice",
  "parser_in_two_institutions",
  "account_listed_twice",
  "account_name_empty",
  "account_name_taken",
  "identifier_on_two_accounts",
  "account_identifier_required",
  "mapping_file_listed_twice",
  // What a batch adds must exist now.
  "unknown_ledger_account",
  "unknown_parser",
]);
export type ImportPresetRefusalCode = z.infer<
  typeof importPresetRefusalCodeSchema
>;

export const importPresetRefusalSchema = z.object({
  error: z.string(),
  code: importPresetRefusalCodeSchema,
  // The change the refusal is about, by its place in the batch; null when
  // the table the whole batch leaves breaks a rule.
  change_index: z.number().int().nullable(),
});
export type ImportPresetRefusal = z.infer<typeof importPresetRefusalSchema>;

// One of a preset's instruction files for the LLM, as it would get it.
export const customMappingsFileSchema = z.object({
  filename: z.string(),
  // Null when user-config/ has no such file: a run skips it.
  content: z.string().nullable(),
});
export type CustomMappingsFile = z.infer<typeof customMappingsFileSchema>;

export const importPresetsContract = c.router({
  listImportPresets: c.query({
    method: "GET",
    path: "/import-presets",
    summary:
      "The import presets: each institution with its parsers and accounts, and each account's ledger account name (null once that account is deleted)",
    responses: {
      200: importPresetsViewSchema,
      403: z.object({ error: z.string() }),
    },
  }),
  changeImportPresets: c.mutation({
    method: "POST",
    path: "/import-presets/changes",
    summary:
      "Apply a batch of changes to the import presets, in order, whole or not at all",
    description:
      "Institutions are named by name, accounts by their ledger account_id. The whole table must keep the presets' rules after the batch, and every account_id and parser the batch adds must exist now. Returns the presets as GET /import-presets does.",
    body: z.object({ changes: z.array(importPresetChangeSchema).min(1) }),
    responses: {
      200: importPresetsViewSchema,
      403: z.object({ error: z.string() }),
      422: importPresetRefusalSchema,
    },
  }),
  // The presets as user-config/import-presets.json still declares them, for
  // the screens that read them until they read the table.
  listImportPresetFile: c.query({
    method: "GET",
    path: "/import-presets/file",
    summary: "List the presets in user-config/import-presets.json",
    responses: {
      200: z.array(importPresetSchema),
      403: z.object({ error: z.string() }),
    },
  }),
  readCustomMappingsFile: c.query({
    method: "GET",
    path: "/import-presets/mapping-files/:filename",
    summary: "Read one of the presets' instruction files in user-config/",
    pathParams: z.object({
      // A file directly in user-config/, never a path.
      filename: z
        .string()
        .regex(/^[^/\\.][^/\\]*$/, "Name a file in user-config/, not a path."),
    }),
    responses: {
      200: customMappingsFileSchema,
      400: z.object({ error: z.string() }),
      403: z.object({ error: z.string() }),
    },
  }),
});
