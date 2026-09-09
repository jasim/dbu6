import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  allRows,
  authorizeReport,
  dateColumn,
  flatResult,
  hiddenIdColumn,
  ledgerCtes,
  moneyColumn,
  openRecordLink,
  textColumn,
  type ScopeParams,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register("assetInflows", reportsContract.assetInflows, ({ c, request }) => {
  const scope = authorizeReport(c, "asset-inflows");
  const rows = loadAssetInflows(c.get("sqlite"), {
    ...scope,
    fromDate: request.query.from_date ?? null,
    toDate: request.query.to_date ?? null,
  });

  return { status: 200, body: toAssetInflowsResult(rows) };
});

export type AssetInflowRow = {
  entry_id: number;
  journal_id: number;
  account_id: number;
  date: string;
  asset_account: string;
  source_accounts: string | null;
  description: string;
  comment: string | null;
  amount: number;
};

type AssetInflowsQuery = ScopeParams & {
  fromDate: string | null;
  toDate: string | null;
};

export function loadAssetInflows(
  sqlite: Parameters<typeof allRows>[0],
  query: AssetInflowsQuery,
): AssetInflowRow[] {
  return allRows<AssetInflowRow>(
    sqlite,
    `${ledgerCtes}
    SELECT
      je.id AS entry_id,
      j.id AS journal_id,
      asset.id AS account_id,
      j.date,
      asset.name AS asset_account,
      (
        SELECT GROUP_CONCAT(name, ', ')
        FROM (
          SELECT DISTINCT source.name
          FROM scoped_journal_entries source_entry
          JOIN scoped_accounts source ON source.id = source_entry.account_id
          WHERE source_entry.journal_id = j.id
            AND source_entry.credit > 0
          ORDER BY source.name
        )
      ) AS source_accounts,
      j.description,
      je.comment,
      je.debit AS amount
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts asset ON asset.id = je.account_id
    WHERE asset.account_type = 'Asset'
      AND je.debit > 0
      AND (@fromDate IS NULL OR j.date >= @fromDate)
      AND (@toDate IS NULL OR j.date <= @toDate)
      AND NOT EXISTS (
        SELECT 1
        FROM scoped_journal_entries source_asset_entry
        JOIN scoped_accounts source_asset
          ON source_asset.id = source_asset_entry.account_id
        WHERE source_asset_entry.journal_id = j.id
          AND source_asset_entry.credit > 0
          AND source_asset.account_type = 'Asset'
      )
    ORDER BY j.date, j.id, je.id`,
    query,
  );
}

export function toAssetInflowsResult(rows: AssetInflowRow[]): GridDataset {
  return flatResult(
    "asset-inflows",
    "All In-flows to asset accounts",
    {
      inflow: [
        hiddenIdColumn("entry_id", "Journal Entry ID"),
        hiddenIdColumn("journal_id", "Journal ID"),
        hiddenIdColumn("account_id", "Account ID"),
        dateColumn("date", "Date", { width: 12 }),
        textColumn("asset_account", "Asset Account", { width: 42 }),
        textColumn("source_accounts", "Source Accounts", { width: 42 }),
        textColumn("description", "Description", {
          width: 50,
          links: [openRecordLink("journals", "journal_id", "Open journal")],
        }),
        textColumn("comment", "Comment", {
          width: 44,
          textDisplay: "multiLine",
        }),
        moneyColumn("amount", "Debit", { width: 16 }),
      ],
    },
    rows,
    {
      rowKey: (row) => `entry:${row.entry_id}`,
      rowLinks: [
        openRecordLink("journal_entries", "entry_id", "Open journal entry"),
        openRecordLink("accounts", "account_id", "Open asset account"),
      ],
    },
  );
}

export default api;
