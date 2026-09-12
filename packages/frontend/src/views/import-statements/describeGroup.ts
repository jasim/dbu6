import type { AutoImportGroupResult, AutoImportPlanFile } from "dbu6-shared";
import {
  formatBalance,
  formatDate,
  formatDateRange,
  formatSigned,
  joinNames,
  maskIdentifier,
  parserLabel,
  plural,
} from "./format";

// A labelled number or fact, for tiles and tables. Never a sentence.
export interface Stat {
  label: string;
  value: string;
}

// What one account's import means to the user, laid out to be scanned:
// whose statement, the one-line verdict, the numbers, then the breakdown.
export interface GroupSummary {
  tone: "new" | "nothing-new";
  // The account the statement went into: the preset's name.
  title: string;
  // Institution, account number, statement span and files, as one caption.
  caption: string;
  // The one sentence that matters. No numbers beyond the count that is the
  // point of the sentence.
  verdict: string;
  // The headline counts and balances, as tiles.
  stats: Stat[];
  // Where the rows that were not new went. Empty when everything was new.
  breakdown: Stat[];
  balances: {
    tone: "verified" | "unverified";
    // Two or three words for the status pill.
    text: string;
    // Why, or where the balances came from. Null when nothing needs saying.
    caption: string | null;
  };
  details: Stat[];
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

function verdict(group: AutoImportGroupResult): {
  tone: GroupSummary["tone"];
  text: string;
} {
  const { draft_transaction_count: fresh, transaction_count: total } =
    group.result;
  if (total === 0) {
    return {
      tone: "nothing-new",
      text: "The statement has no transactions.",
    };
  }
  if (fresh === 0) {
    return {
      tone: "nothing-new",
      text: `Nothing new. All ${plural(total, "transaction")} ${total === 1 ? "was" : "were"} already in your books.`,
    };
  }
  return {
    tone: "new",
    text: `${plural(fresh, "new transaction")} ready to review.`,
  };
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

function stats(group: AutoImportGroupResult): Stat[] {
  const r = group.result;
  const cc = group.is_credit_card;
  const { opening, closing } = r.balance_metadata;
  const rows: Stat[] = [
    { label: "New", value: String(r.draft_transaction_count) },
    { label: "In statement", value: String(r.transaction_count) },
  ];
  const known = r.transaction_count - r.draft_transaction_count;
  if (known > 0) {
    rows.push({ label: "Already in books", value: String(known) });
  }
  if (opening.effective !== null) {
    rows.push({
      label: "Opening",
      value: formatBalance(opening.effective, cc),
    });
  }
  if (closing.effective !== null) {
    rows.push({
      label: "Closing",
      value: formatBalance(closing.effective, cc),
    });
  }
  if (!cc && opening.effective !== null && closing.effective !== null) {
    rows.push({
      label: "Net change",
      value: formatSigned(closing.effective - opening.effective),
    });
  }
  return rows;
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
      label: "Already waiting in Drafts from an earlier import",
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
  const { opening, closing } = group.result.balance_metadata;
  if (closing.effective === null) {
    return {
      tone: "unverified",
      text: "Not verified",
      caption: "The statement prints no closing balance to check against.",
    };
  }
  if (opening.effective === null) {
    return {
      tone: "verified",
      text: "Verified",
      caption: "Closing balance matches the statement's own running balances.",
    };
  }
  if (opening.source === "statement" && closing.source === "statement") {
    return {
      tone: "verified",
      text: "Verified",
      caption: "Opening and closing balances exactly as the statement prints.",
    };
  }
  const provenance: string[] = [];
  if (opening.source === "checkpoint") {
    provenance.push(
      "opening taken from your books' last confirmed balance, as the statement prints none",
    );
  } else if (opening.source === "manual") {
    provenance.push("opening typed in");
  }
  if (closing.source === "per-row") {
    provenance.push("closing taken from the last row's printed balance");
  } else if (closing.source === "manual") {
    provenance.push("closing typed in");
  }
  const caption =
    provenance.length === 0
      ? null
      : `${provenance.join("; ").replace(/^./, (c) => c.toUpperCase())}.`;
  return { tone: "verified", text: "Verified", caption };
}

function details(group: AutoImportGroupResult): Stat[] {
  const r = group.result;
  const rows: Stat[] = [{ label: "Ledger account", value: group.base_account }];
  if (r.gpay_enriched_count > 0) {
    rows.push({
      label: "Descriptions enriched from Google Pay",
      value: String(r.gpay_enriched_count),
    });
  }
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

// `sources` are the batch's file rows; only the ones for this group's files
// are read, for the institution and account number the statement prints.
export function describeGroup(
  group: AutoImportGroupResult,
  sources: readonly AutoImportPlanFile[] = [],
): GroupSummary {
  const head = verdict(group);
  return {
    tone: head.tone,
    title: group.preset_name,
    caption: caption(group, sources),
    verdict: head.text,
    stats: stats(group),
    breakdown: breakdown(group),
    balances: balances(group),
    details: details(group),
    warnings: group.result.warnings,
  };
}
