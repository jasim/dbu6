import { userConfigDir } from "../user-data.js";
import { parse } from "./parsers/hdfc-bank.js";
import { parseAccount } from "./domain/Account.js";
import { normalizeChronological } from "./balance-math.js";
import { runDraftImport, type ImportSummary } from "./draft-import.js";
import type { RowScopeAuth } from "./draft-persistence.js";

const HDFC_BASE_ACCOUNT = parseAccount("assets:bank:hdfc");

// Effects at the edge (file I/O), decisions in runDraftImport's pipeline.
export async function runHdfcImport(
  filePath: string,
  db: any,
  auth?: RowScopeAuth,
): Promise<ImportSummary> {
  console.log(`[import] parsing ${filePath}`);
  const { transactions, openingBalance } = parse(filePath);
  console.log(`[import] parsed ${transactions.length} transactions`);

  return runDraftImport({
    baseAccount: HDFC_BASE_ACCOUNT,
    transactions: normalizeChronological(transactions, "ascending"),
    statementEdgeOpening:
      openingBalance === null
        ? null
        : { value: openingBalance, source: "statement" },
    categorizationConfig: {
      userConfigDir: userConfigDir(),
      customMappingsFilenames: ["custom_mappings_hdfc.prompt"],
      nuabaseApiKey: process.env.NUABASE_API_KEY ?? "",
    },
    logPrefix: "import",
    db,
    auth,
  });
}
