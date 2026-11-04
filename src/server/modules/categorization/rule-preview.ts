import { amount } from "../values/index.js";
import type { StatementTransaction } from "./CategorizedTransaction.js";
import {
  classifyWith,
  compileMappings,
  rulesOfOne,
  type OneRule,
} from "./mapping-rules.js";

/*
 * One rule run alone over rows already in the books and the drafts, through
 * the categorizer's own matching, so what the preview shows is what the
 * categorizer will do: per statement, how many rows it catches, their
 * amounts, and where they sit now.
 */

// A row the rule may catch: a draft, or a posted journal's categorized line.
export interface PreviewRow extends StatementTransaction {
  posted: boolean;
  // The account the row sits in now; null for a draft with none.
  nowIn: string | null;
}

export interface RulePreviewStatement {
  // The account whose statement prints the rows; null for rows of no ledger
  // account's statement.
  statement: string | null;
  drafts: number;
  posted: number;
  least: number;
  most: number;
  // Most first.
  now_in: { account: string | null; count: number }[];
}

export interface RulePreview {
  // Most rows first.
  statements: RulePreviewStatement[];
}

/**
 * What `rule` catches among `rows`, by statement. Throws as `compileMappings`
 * does for a rule the file would refuse.
 */
export function previewRule(
  rule: OneRule,
  rows: Iterable<PreviewRow>,
): RulePreview {
  const compiled = compileMappings(rulesOfOne(rule));
  const byStatement = new Map<
    string | null,
    RulePreviewStatement & { nowIn: Map<string | null, number> }
  >();
  for (const row of rows) {
    if (classifyWith(compiled, row) === null) continue;
    const moved = amount(row.transaction);
    const entry = byStatement.get(row.statementAccount) ?? {
      statement: row.statementAccount,
      drafts: 0,
      posted: 0,
      least: moved,
      most: moved,
      now_in: [],
      nowIn: new Map(),
    };
    if (row.posted) entry.posted++;
    else entry.drafts++;
    entry.least = Math.min(entry.least, moved);
    entry.most = Math.max(entry.most, moved);
    entry.nowIn.set(row.nowIn, (entry.nowIn.get(row.nowIn) ?? 0) + 1);
    byStatement.set(row.statementAccount, entry);
  }
  const statements = [...byStatement.values()].map(({ nowIn, ...entry }) => ({
    ...entry,
    now_in: [...nowIn]
      .map(([account, count]) => ({ account, count }))
      .sort(
        (a, b) =>
          b.count - a.count || (a.account ?? "").localeCompare(b.account ?? ""),
      ),
  }));
  statements.sort(
    (a, b) =>
      b.drafts + b.posted - (a.drafts + a.posted) ||
      (a.statement ?? "").localeCompare(b.statement ?? ""),
  );
  return { statements };
}
