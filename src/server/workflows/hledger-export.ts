import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  buildHledgerBooks,
  buildHledgerExpectations,
  renderHledgerBooks,
  type ExpectedBalanceSheet,
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

/** The file verify.py checks the export against. */
const EXPECTED_FILE = "dbu6-expected.json";
const VERIFY_FILE = "verify.py";

/**
 * The books as hledger journal files: main.journal declaring every account
 * and including one file per bank or card the import presets list, in the
 * presets' order, then the journals none of them touches. After them come
 * dbu6-expected.json, what hledger should find (`balanceSheet` is dbu6's
 * Balance Sheet over every journal, which this tier can't run), and
 * `verifyScript`, the verify.py that checks it.
 */
export function exportHledgerBooks({
  db,
  auth,
  balanceSheet,
  verifyScript,
  now,
  random,
}: {
  db: BetterSQLite3Database;
  auth: LedgerAuth;
  balanceSheet: ExpectedBalanceSheet;
  verifyScript: string;
  now: string;
  random: () => number;
}): HledgerExport {
  const { accounts, journals } = loadHledgerExportRows(db, auth);
  const statementAccounts = loadImportPresets(db, auth).flatMap((institution) =>
    institution.accounts.map((account) => ({
      account_id: account.account_id,
      name: account.name,
    })),
  );

  const input = { accounts, journals, statementAccounts };
  const books = buildHledgerBooks(input);
  const expectations = buildHledgerExpectations({
    input,
    balanceSheet,
    generatedAt: now,
    random,
  });
  const counts = new Map(
    books.files.map((file) => [file.path, file.transactions.length]),
  );

  return {
    files: [
      ...renderHledgerBooks(books).map((file) => ({
        ...file,
        transaction_count: counts.get(file.path) ?? 0,
      })),
      {
        path: EXPECTED_FILE,
        content: `${JSON.stringify(expectations, null, 2)}\n`,
        transaction_count: 0,
      },
      { path: VERIFY_FILE, content: verifyScript, transaction_count: 0 },
    ],
    journal_count: journals.length,
  };
}
