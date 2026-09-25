import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { dateSpanSchema } from "./date-span.js";
import {
  statementImportErrorSchema,
  type StatementImportError,
} from "./import-errors.js";
import { importPresetRefusalCodeSchema } from "./import-presets.js";

const c = initContract();

/*
 * Adding a bank or card from its statements (/add). Nothing here is special
 * to onboarding: `read` is /import's recognition and plan with no writes,
 * and `add` creates the account, then runs /import's ordinary import on the
 * same files. The browser holds the dropped files between the two and sends
 * them again; the server keeps nothing between requests but the staged
 * copies a coding-agent prompt points at.
 *
 * Both take multipart `files` (repeated). Cash, deposits and loans (C1) have
 * no endpoint here: they are the chart's accounts, recorded with
 * POST /opening-balances.
 */

// The balance the account opened at, the day before the statements' first
// row: the earliest one's own opening, else its first printed balance less
// the rows up to it, else its closing less every row. Ledger sign: positive
// when held, negative when owed.
export const statementOpeningSchema = z.object({
  date: z.string(),
  // Null when the statements print no balances, and the user gives it.
  amount: z.number().nullable(),
});
export type StatementOpening = z.infer<typeof statementOpeningSchema>;

// Who categorizes an import, or why nobody can: the check categorization
// itself makes.
export const categorizerStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true), name: z.string() }),
  z.object({ ready: z.literal(false), name: z.string(), reason: z.string() }),
]);
export type CategorizerStatus = z.infer<typeof categorizerStatusSchema>;

// One dropped file, as the read found it. `saved_path` is where its staged
// copy is kept (inside the project) for a coding agent's prompt; the read
// keeps the drop only when the card it leads to hands the user one: a file
// no parser reads or several do, or a refusal /import gives a prompt for
// (`refusalPromptsAgent`).
export const addAccountFileSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("read"),
    file_name: z.string(),
    // The `key` of the account in the reply's `accounts` it belongs to.
    account_key: z.string(),
    parser: z.string(),
    // First and last row dates; null for a statement with no rows.
    period: dateSpanSchema.nullable(),
    transactions: z.number().int(),
    // Null unless the drop is kept.
    saved_path: z.string().nullable(),
  }),
  // No saved parser reads it: the Teach card.
  z.object({
    status: z.literal("unrecognized"),
    file_name: z.string(),
    saved_path: z.string(),
    candidate_parser_paths: z.array(z.string()),
  }),
  // Several parsers read it: the Teach card, with /import's prompt for
  // telling them apart.
  z.object({
    status: z.literal("ambiguous"),
    file_name: z.string(),
    saved_path: z.string(),
    matching_parser_paths: z.array(z.string()),
  }),
]);
export type AddAccountFile = z.infer<typeof addAccountFileSchema>;

export const addAccountStatusSchema = z.enum([
  // No bank or card in the books takes these statements. Adding creates
  // the account, or ties one in the books that no bank or card uses yet.
  "new",
  // A bank or card set up for statements, with no transactions yet: its
  // bank lists the parser, or lists none and the account has the number
  // the statements print. Adding records its opening balance and imports,
  // as for a new one.
  "empty",
  // A bank or card with transactions: its statements go through /import.
  "in_books",
]);
export type AddAccountStatus = z.infer<typeof addAccountStatusSchema>;

// One account the dropped files belong to. Files belong to one account when
// the parsers' bank and the number they print agree.
export const addAccountCandidateSchema = z.object({
  // Stable for the same files; what `read` files point at.
  key: z.string(),
  status: addAccountStatusSchema,
  // The bank or card in the books, for `empty` and `in_books`.
  account: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  // The bank: the preset institution the account is in or that lists the
  // parser (`institution_listed`), else the name the statement prints,
  // tidied ("HDFC BANK Ltd." is "HDFC Bank") and spelled as a preset
  // institution of that name is; "" when it prints none.
  institution: z.string(),
  // A preset institution lists the parser, or the account is `empty` or
  // `in_books`. When not, `add` needs a bank name (`institution`), which
  // Confirm asks for, prefilled with `institution`.
  institution_listed: z.boolean(),
  // Bank or card: the preset's for `empty` and `in_books`; for `new`, what
  // the statements print, null when they print no account number (the user
  // says which it is).
  kind: accountKindSchema.nullable(),
  identifier: z.string().nullable(),
  parsers: z.array(z.string()),
  // In date order.
  file_names: z.array(z.string()),
  period: dateSpanSchema.nullable(),
  transactions: z.number().int(),
  // The balance the day before the first row, ledger sign (owed is
  // negative); `amount` is null when the statements print no balance at
  // all, and the user gives it. Null with no rows.
  opening: statementOpeningSchema.nullable(),
  // The statements print no balance and the account has no opening entry:
  // `add` needs `opening_amount`, the balance on `opening.date`.
  needs_opening: z.boolean(),
  // Why the opening can't be recorded as the books stand, which `add`
  // refuses with: the account's opening entry is dated on or after the
  // first row, or the day before at another balance; or another account's
  // import put a transaction on it before the first row.
  opening_refusal: z
    .object({
      code: z.enum([
        "opening_after_statement_start",
        "opening_disagrees",
        "activity_before_statement",
      ]),
      error: z.string(),
    })
    .nullable(),
  // The refusal importing these files would give, as /import reports it,
  // or null when they would go in: a gap between two statements, a part
  // that can't be placed, rows that don't add up.
  refusal: statementImportErrorSchema.nullable(),
});
export type AddAccountCandidate = z.infer<typeof addAccountCandidateSchema>;

export const addAccountReadingSchema = z.object({
  // In the order they were dropped.
  files: z.array(addAccountFileSchema),
  // By each one's first date, earliest first; those with no rows last.
  accounts: z.array(addAccountCandidateSchema),
  // Who categorizes the import `add` runs.
  categorizer: categorizerStatusSchema,
});
export type AddAccountReading = z.infer<typeof addAccountReadingSchema>;

// The form fields `add` takes beside `files`, as the multipart body carries
// them: strings, which the server coerces. An empty field is one not sent.
export const addAccountFieldsSchema = z.object({
  // Needed only when the statements print no account number (`kind` null).
  kind: accountKindSchema.optional(),
  // The bank; needed only when `institution_listed` is false. A preset
  // institution of that name takes the account and the parser, else one is
  // added.
  institution: z.string().trim().min(1).optional(),
  // A new ledger account, of the kind's type, under `parent_id`: by
  // default the parent most banks or cards of the kind share
  // (`default_parents` of GET /setup/statement-accounts); with none, it
  // must be sent...
  name: z.string().trim().min(1).optional(),
  parent_id: z.coerce.number().int().positive().optional(),
  // ...or one in the books: an Asset or Liability no bank or card uses, or
  // the `empty` bank or card itself. Neither is needed for `empty`.
  account_id: z.coerce.number().int().positive().optional(),
  // Ledger sign. Needed only when `needs_opening`.
  opening_amount: z.coerce.number().finite().optional(),
});
export type AddAccountFields = z.infer<typeof addAccountFieldsSchema>;

export const addAccountAddedSchema = z.object({
  account_id: z.number().int(),
  account_name: z.string(),
  // Drafts the import made, for the hand-off.
  drafts: z.number().int(),
});
export type AddAccountAdded = z.infer<typeof addAccountAddedSchema>;

export const addAccountRefusalSchema = z.object({
  // In the user's words.
  error: z.string(),
  code: z.enum([
    "missing_multipart_field",
    // The fields don't parse; or a new account has neither a name nor an
    // account from the chart, no group when no bank or card of its kind has
    // one to share, no kind when the statements print none, or no bank
    // name when `institution_listed` is false.
    "invalid_fields",
    // A file no saved parser reads, or several do.
    "statement_unreadable",
    // The files belong to more than one account: add them one at a time.
    "several_accounts",
    // The account has transactions: its statements go through Import.
    "already_in_books",
    "statement_has_no_transactions",
    // The statements print no balance, and no `opening_amount` was sent.
    "opening_balance_needed",
    // The account's opening entry is dated on or after the first row.
    "opening_after_statement_start",
    // The account's opening entry is dated the day before the first row, at
    // another balance.
    "opening_disagrees",
    // Another account's import put a transaction on this one before the
    // statements start, where the opening goes.
    "activity_before_statement",
    "opening_balance_refused",
    // The import's own checks refused the files; `import_error` is the
    // refusal as /import reports it.
    "import_refused",
    // The ledger already has an account of that name.
    "ledger_name_taken",
    // The parent is not an account of the kind's type.
    "parent_not_suitable",
    // The account to use is not an Asset or Liability of that kind, or a
    // bank or card already uses it.
    "account_not_suitable",
    // The account to use has accounts under it: a group takes no statements.
    "account_has_children",
    // The presets' own rules.
    ...importPresetRefusalCodeSchema.options,
  ]),
  import_error: statementImportErrorSchema.optional(),
  // With an `import_error` /import gives a coding-agent prompt for
  // (`refusalPromptsAgent`): where each file's staged copy is kept.
  files: z
    .array(z.object({ file_name: z.string(), saved_path: z.string() }))
    .optional(),
});
export type AddAccountRefusal = z.infer<typeof addAccountRefusalSchema>;

/**
 * Whether /import hands the user a coding-agent prompt for this refusal
 * (views/import-statements/describeProblems.ts), and so whether the files
 * stay staged for it. A gap has the flow's own card (add the missing
 * statement, or start after it), and a part with no balances or a missing
 * opening are the user's to fix, so those keep nothing.
 */
export function refusalPromptsAgent(error: StatementImportError): boolean {
  switch (error.error) {
    case "statement_boundary_mismatch":
      return error.reason === "same-statement-twice";
    case "statement_part_unjoinable":
    case "opening_balance_unavailable":
      return false;
    default:
      return true;
  }
}

export const addAccountContract = c.router({
  readStatements: c.mutation({
    method: "POST",
    path: "/add-account/read",
    summary:
      "Read dropped statements (`files`, repeated) as /import would, writing nothing to the books: which account each belongs to, whether that account is new, empty or in the books, its dates, rows and opening, whether the opening must be typed, the refusal importing them would give, and who categorizes. The files stay staged under tmp/statement-uploads/ only when a coding agent's prompt needs them",
    contentType: "multipart/form-data",
    body: z.any(),
    responses: {
      200: addAccountReadingSchema,
      400: addAccountRefusalSchema,
      403: errorBodySchema,
    },
  }),
  addAccount: c.mutation({
    method: "POST",
    path: "/add-account/add",
    summary:
      "Add a bank or card from its statements (`files`, all one account's; fields per addAccountFieldsSchema): create the ledger account and its preset entry (or use the one named, or the empty one the files belong to), tie it to the parser and number, record its opening balance the day before the earliest row, then import the files as /import does, categorization included. Everything that doesn't depend on timing is checked before anything is written",
    contentType: "multipart/form-data",
    body: z.any(),
    responses: {
      200: addAccountAddedSchema,
      // The request's fields or files.
      400: addAccountRefusalSchema,
      403: errorBodySchema,
      422: addAccountRefusalSchema,
    },
  }),
});
