import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import {
  formatBalance,
  formatDate,
  formatDateRange,
  joinNames,
  maskIdentifier,
  parserLabel,
  plural,
} from "./format";

// A labelled fact, for the facts tables. Values are figures (money, dates,
// counts, codes) set in mono unless marked as words.
export interface Stat {
  label: string;
  value: string;
  face?: "figure" | "words";
}

// One account's row in the results card, laid out to be scanned: whose
// statement, the status, the counts, the balances, then the details.
export interface GroupSummary {
  tone: "new" | "nothing-new";
  // The account the statement went into: the preset's name.
  title: string;
  // Institution, account number, statement span and files, as one caption.
  caption: string;
  // The status chip's words: "21 new" or "Nothing new".
  chip: string;
  // The counts as a sentence: "8 in the statement: 5 new, 3 already in your
  // books".
  counts: string;
  balances:
    | { tone: "verified"; text: string; figures: string }
    | { tone: "unverified"; text: string; figures: null };
  // "Named 6 UPI payments from Google Pay", or null when none were named.
  gpay: string | null;
  // Collapsed under "Details": where the rows that were not new went (empty
  // when everything was new), then the facts behind the import.
  breakdown: Stat[];
  details: Stat[];
}

export const REVIEW_DRAFTS_ROUTE = "/review";

type Balance = AutoImportGroupResult["result"]["balance_metadata"]["opening"];

function sourceLabel(source: Balance["source"]): string {
  switch (source) {
    case "statement":
      return "from the statement";
    case "checkpoint":
      return "from your books' last confirmed balance";
    case "per-row":
      return "from the last row's printed balance";
    case "none":
      return "not available";
  }
}

function counts(group: AutoImportGroupResult): string {
  const { draft_transaction_count: fresh, transaction_count: total } =
    group.result;
  if (total === 0) return "The statement has no transactions.";
  const known = total - fresh;
  const parts = [
    fresh > 0 ? `${fresh} new` : null,
    known > 0 ? `${known} already in your books` : null,
  ].filter((part): part is string => part !== null);
  return `${total} in the statement: ${parts.join(", ")}`;
}

function caption(
  group: AutoImportGroupResult,
  sources: readonly AutoImportPlanFile[],
): string {
  const resolved = sources.filter(
    (row): row is Extract<AutoImportPlanFile, { status: "resolved" }> =>
      row.status === "resolved" && group.file_names.includes(row.file_name),
  );
  const institutions = Array.from(
    new Set(
      resolved
        .map((row) => row.institution)
        .filter((name): name is string => name !== null),
    ),
  );
  const accounts = Array.from(
    new Set(
      resolved
        .map((row) => row.account)
        .filter(
          (account): account is NonNullable<typeof account> => account !== null,
        )
        .map(
          (account) =>
            `${account.kind === "card" ? "card" : "account"} ${maskIdentifier(account.identifier)}`,
        ),
    ),
  );
  const period = group.result.statement_period;
  return [
    ...institutions,
    ...accounts,
    period ? formatDateRange(period.first_date, period.last_date) : null,
    joinNames(group.file_names),
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

function breakdown(group: AutoImportGroupResult): Stat[] {
  const r = group.result;
  const rows: Stat[] = [];
  if (r.skipped_reconciled_count > 0) {
    rows.push({
      label: r.reconciliation_checkpoint
        ? `Posted on or before ${formatDate(r.reconciliation_checkpoint.date)}, your last confirmed balance`
        : "Posted before this account was last confirmed",
      value: String(r.skipped_reconciled_count),
    });
  }
  if (r.draft_duplicate_count > 0) {
    rows.push({
      label: "Already waiting in Review from an earlier import",
      value: String(r.draft_duplicate_count),
    });
  }
  if (r.journal_duplicate_count > 0) {
    rows.push({
      label: "Already posted from an earlier import",
      value: String(r.journal_duplicate_count),
    });
  }
  return rows;
}

function balances(group: AutoImportGroupResult): GroupSummary["balances"] {
  const cc = group.is_credit_card;
  const { opening, closing } = group.result.balance_metadata;
  if (closing.effective === null) {
    return {
      tone: "unverified",
      text: "Balances not checked: the statement prints no closing balance",
      figures: null,
    };
  }
  const closingText = formatBalance(closing.effective, cc);
  return {
    tone: "verified",
    text: "Balances match the statement",
    figures:
      opening.effective === null
        ? closingText
        : `${formatBalance(opening.effective, cc)} → ${closingText}`,
  };
}

function details(group: AutoImportGroupResult): Stat[] {
  const r = group.result;
  const rows: Stat[] = [{ label: "Ledger account", value: group.base_account }];
  const parsers = Array.from(new Set(r.custom_statement_parser_paths ?? []));
  if (parsers.length > 0) {
    rows.push({
      label: "Read with",
      value: parsers
        .map((path) => `${parserLabel(path)} reader (${path})`)
        .join(", "),
    });
  }
  rows.push({
    label: "Balance sources",
    value: `Opening ${sourceLabel(r.balance_metadata.opening.source)}, closing ${sourceLabel(r.balance_metadata.closing.source)}`,
    face: "words",
  });
  if (r.reconciliation_checkpoint) {
    rows.push({
      label: "Last confirmed balance",
      value: `${formatBalance(r.reconciliation_checkpoint.balance, group.is_credit_card)} on ${formatDate(r.reconciliation_checkpoint.date)}`,
    });
  }
  return rows;
}

// `sources` are the batch's file rows; only the ones for this group's files
// are read, for the institution and account number the statement prints.
export function describeGroup(
  group: AutoImportGroupResult,
  sources: readonly AutoImportPlanFile[] = [],
): GroupSummary {
  const fresh = group.result.draft_transaction_count;
  const enriched = group.result.gpay_enriched_count;
  return {
    tone: fresh > 0 ? "new" : "nothing-new",
    title: group.preset_name,
    caption: caption(group, sources),
    chip: fresh > 0 ? `${fresh} new` : "Nothing new",
    counts: counts(group),
    balances: balances(group),
    gpay:
      enriched > 0
        ? `Named ${plural(enriched, "UPI payment")} from Google Pay`
        : null,
    breakdown: breakdown(group),
    details: details(group),
  };
}
