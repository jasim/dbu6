import type { AutoImportGroupResult } from "dbu6-shared";
import {
  formatBalance,
  formatDate,
  formatDateRange,
  formatSigned,
  joinNames,
  parserLabel,
  plural,
} from "./format";

// What one account's import means to the user, in the order they ask:
// is there anything new, is the money right, and then the breakdown.
export interface GroupSummary {
  tone: "new" | "nothing-new";
  headline: string;
  // The statement span and the files it came from.
  subline: string;
  // Why rows were not new, one sentence per reason that applies.
  alreadyKnown: string[];
  money: { tone: "verified" | "unverified"; text: string };
  details: Array<{ label: string; value: string }>;
  warnings: string[];
}

export const REVIEW_DRAFTS_ROUTE = "/views/reclassify-drafts";

type Balance = AutoImportGroupResult["result"]["balance_metadata"]["opening"];

function sourceLabel(source: Balance["source"]): string {
  switch (source) {
    case "manual":
      return "typed in";
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

function headline(group: AutoImportGroupResult): {
  tone: GroupSummary["tone"];
  text: string;
} {
  const { draft_transaction_count: fresh, transaction_count: total } =
    group.result;
  const known = total - fresh;
  if (total === 0) {
    return {
      tone: "nothing-new",
      text: `Nothing to import from ${group.preset_name}: the statement has no transactions.`,
    };
  }
  if (fresh === 0) {
    return {
      tone: "nothing-new",
      text: `Nothing new from ${group.preset_name}. All ${plural(total, "transaction")} were already in your books.`,
    };
  }
  if (known === 0) {
    return {
      tone: "new",
      text: `${plural(fresh, "new transaction")} from ${group.preset_name}, ready to review.`,
    };
  }
  return {
    tone: "new",
    text: `${plural(fresh, "new transaction")} from ${group.preset_name}. ${known} ${known === 1 ? "was" : "were"} already in your books.`,
  };
}

function alreadyKnown(group: AutoImportGroupResult): string[] {
  const r = group.result;
  const lines: string[] = [];
  if (r.skipped_reconciled_count > 0) {
    lines.push(
      r.reconciliation_checkpoint
        ? `${r.skipped_reconciled_count} dated on or before your last confirmed balance (${formatDate(r.reconciliation_checkpoint.date)}) ${r.skipped_reconciled_count === 1 ? "was" : "were"} already posted.`
        : `${r.skipped_reconciled_count} ${r.skipped_reconciled_count === 1 ? "was" : "were"} already posted before this account was last confirmed.`,
    );
  }
  if (r.draft_duplicate_count > 0) {
    lines.push(
      `${r.draft_duplicate_count} ${r.draft_duplicate_count === 1 ? "is" : "are"} already waiting in Drafts from an earlier import.`,
    );
  }
  if (r.journal_duplicate_count > 0) {
    lines.push(
      `${r.journal_duplicate_count} ${r.journal_duplicate_count === 1 ? "was" : "were"} already posted from an earlier import.`,
    );
  }
  return lines;
}

function money(group: AutoImportGroupResult): GroupSummary["money"] {
  const { opening, closing } = group.result.balance_metadata;
  const cc = group.is_credit_card;
  if (closing.effective === null) {
    return {
      tone: "unverified",
      text: "The statement prints no closing balance, so the total could not be checked against the bank.",
    };
  }
  const close = formatBalance(closing.effective, cc);
  if (opening.effective === null) {
    return {
      tone: "verified",
      text: `Closing balance ${close} matches the statement's own running balances.`,
    };
  }
  const open = formatBalance(opening.effective, cc);
  const change = cc
    ? ""
    : `, net change ${formatSigned(closing.effective - opening.effective)}`;
  const provenance: string[] = [];
  if (opening.source === "statement" && closing.source === "statement") {
    provenance.push("exactly as the statement prints");
  } else {
    if (opening.source === "checkpoint") {
      provenance.push(
        "the statement prints no opening balance, so the opening is your books' last confirmed balance",
      );
    } else if (opening.source === "manual") {
      provenance.push("the opening was typed in");
    }
    if (closing.source === "per-row") {
      provenance.push("the closing is the last row's printed balance");
    } else if (closing.source === "manual") {
      provenance.push("the closing was typed in");
    }
  }
  const tail = provenance.length === 0 ? "" : `, ${provenance.join("; ")}`;
  return {
    tone: "verified",
    text: `Balances verified: ${cc ? "" : "opening "}${open} at the start, ${close} at the end${change}${tail}.`,
  };
}

function details(group: AutoImportGroupResult): GroupSummary["details"] {
  const r = group.result;
  const rows: GroupSummary["details"] = [
    {
      label: "Transactions in the statement",
      value: String(r.transaction_count),
    },
    { label: "New, added to Drafts", value: String(r.draft_transaction_count) },
  ];
  if (r.skipped_reconciled_count > 0) {
    rows.push({
      label: r.reconciliation_checkpoint
        ? `Already in your books (on or before ${formatDate(r.reconciliation_checkpoint.date)})`
        : "Already in your books",
      value: String(r.skipped_reconciled_count),
    });
  }
  if (r.draft_duplicate_count > 0) {
    rows.push({
      label: "Already waiting in Drafts",
      value: String(r.draft_duplicate_count),
    });
  }
  if (r.journal_duplicate_count > 0) {
    rows.push({
      label: "Already posted earlier",
      value: String(r.journal_duplicate_count),
    });
  }
  if (r.gpay_enriched_count > 0) {
    rows.push({
      label: "Descriptions enriched from Google Pay",
      value: String(r.gpay_enriched_count),
    });
  }
  rows.push({ label: "Ledger account", value: group.base_account });
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
    value: `opening ${sourceLabel(r.balance_metadata.opening.source)}, closing ${sourceLabel(r.balance_metadata.closing.source)}`,
  });
  if (r.reconciliation_checkpoint) {
    rows.push({
      label: "Last confirmed balance",
      value: `${formatBalance(r.reconciliation_checkpoint.balance, group.is_credit_card)} on ${formatDate(r.reconciliation_checkpoint.date)}`,
    });
  }
  return rows;
}

export function describeGroup(group: AutoImportGroupResult): GroupSummary {
  const head = headline(group);
  const period = group.result.statement_period;
  const span = period
    ? `Statement ${formatDateRange(period.first_date, period.last_date)}`
    : "Statement";
  return {
    tone: head.tone,
    headline: head.text,
    subline: `${span} · ${joinNames(group.file_names)}`,
    alreadyKnown: alreadyKnown(group),
    money: money(group),
    details: details(group),
    warnings: group.result.warnings,
  };
}
