import type Database from "better-sqlite3";
import type { PreviewRow } from "../categorization/index.js";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";
import { moneyFromColumns } from "../values/index.js";

interface StoredRow {
  narration: string;
  withdrawal: number;
  deposit: number;
  statement: string | null;
  now_in: string | null;
  posted: 0 | 1;
}

/**
 * Every statement row in the drafts and the books, as a rule would meet it,
 * for previewing a rule: its narration, money and statement account, and
 * where it sits now. A draft's statement is its `base_account_id`. In a
 * posted journal the line with `source_narration` is the categorized side
 * and the journal's line without one is the statement; a debit on the
 * categorized line is money out of the statement. A grouped journal from
 * before 2026-09-24 holds several categorized lines beside one statement
 * line, and each is a row.
 */
export function loadRulePreviewRows(
  sqlite: Database.Database,
  auth: LedgerAuth,
): PreviewRow[] {
  const rows = allRows<StoredRow>(
    sqlite,
    auth,
    `SELECT d.source_narration AS narration, d.withdrawal, d.deposit,
            b.name AS statement, a.name AS now_in, 0 AS posted
     FROM scoped_draft_transactions d
     LEFT JOIN scoped_accounts b ON b.id = d.base_account_id
     LEFT JOIN scoped_accounts a ON a.id = d.account_id
     UNION ALL
     SELECT c.source_narration, c.debit, c.credit,
            (SELECT sa.name FROM scoped_journal_entries s
             JOIN scoped_accounts sa ON sa.id = s.account_id
             WHERE s.journal_id = c.journal_id AND s.id <> c.id
               AND s.source_narration IS NULL
             ORDER BY s.id LIMIT 1),
            a.name, 1
     FROM scoped_journal_entries c
     LEFT JOIN scoped_accounts a ON a.id = c.account_id
     WHERE c.source_narration IS NOT NULL`,
  );
  return rows.flatMap((row): PreviewRow[] => {
    // A row that moves no money one way is nothing a rule meets.
    let money;
    try {
      money = moneyFromColumns(row);
    } catch {
      return [];
    }
    return [
      {
        transaction: {
          date: "",
          narration: row.narration,
          balance: null,
          ...money,
        },
        statementAccount: row.statement,
        nowIn: row.now_in,
        posted: row.posted === 1,
      },
    ];
  });
}
