import { userConfigDir } from "../user-data.js";
import { parse } from "./parsers/federal-bank.js";
import { parseAccount } from "./domain/Account.js";
import { enrichWithGPayHtml } from "./domain/GPayIndex.js";
import { normalizeChronological } from "./balance-math.js";
import { runDraftImport, type ImportSummary } from "./draft-import.js";
import type { RowScopeAuth } from "./draft-persistence.js";

const FEDERAL_BASE_ACCOUNT = parseAccount("assets:bank:federal");

export async function runFederalImport(
  filePath: string,
  db: any,
  auth?: RowScopeAuth,
  gpayHtmlPath?: string,
): Promise<ImportSummary> {
  console.log(`[import] parsing ${filePath}`);
  const { transactions } = parse(filePath);
  console.log(`[import] parsed ${transactions.length} transactions`);

  let enrichedTxns = transactions;
  let gpayEnrichedCount = 0;
  if (gpayHtmlPath) {
    console.log(`[import] reading GPay takeout ${gpayHtmlPath}`);
    const result = enrichWithGPayHtml(transactions, gpayHtmlPath);
    console.log(`[import] GPay index: ${result.indexSize} (date,amount) keys`);
    enrichedTxns = result.enriched;
    gpayEnrichedCount = result.matchCount;
    console.log(`[import] enriched ${gpayEnrichedCount} narrations from GPay`);
  }

  const summary = await runDraftImport({
    baseAccount: FEDERAL_BASE_ACCOUNT,
    transactions: normalizeChronological(enrichedTxns, "ascending"),
    categorizationConfig: {
      userConfigDir: userConfigDir(),
      customMappingsFilenames: ["custom_mappings_federal.prompt"],
      nuabaseApiKey: process.env.NUABASE_API_KEY ?? "",
    },
    logPrefix: "import",
    db,
    auth,
  });

  return { ...summary, gpay_enriched_count: gpayEnrichedCount };
}
