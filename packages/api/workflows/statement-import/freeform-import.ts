import type { AbacusImportRequest, AccountKind } from "dbu6-shared";
import {
  abacusStatementFromJson,
  verifyDeclaredBalances,
} from "../../modules/statement/index.js";
import { parseAccount } from "../../modules/values/index.js";
import { categorizationLlm } from "../../modules/coding-agent/index.js";
import { loadCategorizer } from "../../modules/categorization/index.js";
import type { Ledger } from "../../modules/ledger-sql/index.js";
import {
  runStatementImport,
  type StatementImportResult,
} from "./statement-import.js";

// Import of one Abacus statement a coding agent assembled from freeform
// transactions (custom-built-parsers/freeform-transactions-guide.md).
//
//   the statement, with both balances -> BalancedStatement
//     -> verifyDeclaredBalances: the rows lead from the opening to the closing
//     -> runStatementImport([statement], the account and kind the user chose)
//
// No import preset is involved: freeform rows are categorized without a
// preset's custom mappings. The statement states its opening and closing
// balances, and the parsed statement keeps them in its type, so the rows are
// checked against both before anything is saved. A parse or balance failure
// is thrown as the statement's own error.

export interface FreeformStatement {
  // The ledger account, as the user named it.
  baseAccount: string;
  accountKind: AccountKind;
  statement: AbacusImportRequest["statement"];
  // A short label for the result and for error messages.
  sourceName: string;
}

export type FreeformImportOutcome =
  // The drafts would otherwise be saved with no base account at all.
  | { kind: "account-not-found" }
  | { kind: "imported"; result: StatementImportResult };

export async function importFreeformStatement(
  freeform: FreeformStatement,
  ledgerAccountNames: ReadonlySet<string>,
  ledger: Ledger,
): Promise<FreeformImportOutcome> {
  const { baseAccount, accountKind, statement, sourceName } = freeform;
  if (!ledgerAccountNames.has(baseAccount)) {
    return { kind: "account-not-found" };
  }

  console.log(
    `[abacus-import] ${statement.rows.length} row(s) from ${JSON.stringify(sourceName)} into ${baseAccount}`,
  );
  const llm = await categorizationLlm();
  const balanced = abacusStatementFromJson(statement);
  verifyDeclaredBalances(balanced);
  const result = await runStatementImport(
    [balanced],
    {
      baseAccount: parseAccount(baseAccount),
      accountKind,
      categorizer: await loadCategorizer({ customMappingsFilenames: [], llm }),
      gpay: null,
    },
    ledger,
    [sourceName],
  );
  return { kind: "imported", result };
}
