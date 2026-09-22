import { z } from "zod";

// The account or card identifier a statement prints about itself, in one
// canonical form so that a parser's output and an import preset can be
// compared with plain string equality:
//
// - bank: the full printed account number, digits only.
// - card: the printed masked card number with spaces removed and the mask
//   character uppercased, e.g. `1234 56XX XXXX 7890` -> `123456XXXXXX7890`.
//
// Deterministic parsers under custom-built-parsers/ apply this rule when they
// emit `account`; see custom-built-parsers/import-statement-parser-guide.md.
export const statementAccountKindSchema = z.enum(["bank", "card"]);
export type StatementAccountKind = z.infer<typeof statementAccountKindSchema>;

const BANK_IDENTIFIER_RE = /^[0-9]+$/;
const CARD_IDENTIFIER_RE = /^[0-9X]+$/;

export const statementAccountIdentifierSchema = z
  .string()
  .regex(
    CARD_IDENTIFIER_RE,
    "Statement account identifier must contain only digits and uppercase X, with no spaces",
  );

export const statementAccountSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bank"),
    identifier: z
      .string()
      .regex(
        BANK_IDENTIFIER_RE,
        "Bank account identifier must be the printed account number, digits only",
      ),
  }),
  z.object({
    kind: z.literal("card"),
    identifier: statementAccountIdentifierSchema,
  }),
]);
export type StatementAccount = z.infer<typeof statementAccountSchema>;
