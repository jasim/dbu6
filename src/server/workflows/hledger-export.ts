import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  buildHledgerBooks,
  renderHledgerBooks,
  type RenderedFile,
} from "../modules/hledger-export/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { loadHledgerExportRows } from "../modules/journals/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";

export interface ExportedHledgerFile extends RenderedFile {
  /** The transactions the file holds; 0 for main.journal. */
  transaction_count: number;
}

export interface HledgerExport {
  files: ExportedHledgerFile[];
  journal_count: number;
}

/**
 * The books as hledger journal files: main.journal declaring every account
 * and including one file per bank or card the import presets list, in the
 * presets' order, then the journals none of them touches.
 */
export function exportHledgerBooks({
  db,
  auth,
}: {
  db: BetterSQLite3Database;
  auth: LedgerAuth;
}): HledgerExport {
  const { accounts, journals } = loadHledgerExportRows(db, auth);
  const statementAccounts = loadImportPresets(db, auth).flatMap((institution) =>
    institution.accounts.map((account) => ({
      account_id: account.account_id,
      name: account.name,
    })),
  );

  const books = buildHledgerBooks({ accounts, journals, statementAccounts });
  const counts = new Map(
    books.files.map((file) => [file.path, file.transactions.length]),
  );

  return {
    files: renderHledgerBooks(books).map((file) => ({
      ...file,
      transaction_count: counts.get(file.path) ?? 0,
    })),
    journal_count: journals.length,
  };
}
