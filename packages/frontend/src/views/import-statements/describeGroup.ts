import {
  accountKindOf,
  type AccountKind,
  type AutoImportGroupResult,
  type AutoImportPlanFile,
} from "dbu6-shared";
import type { Fact } from "../../components/fact-table";
import {
  formatBalance,
  formatDate,
  formatDateRange,
  formatShortDate,
  joinNames,
  maskIdentifier,
  plural,
} from "../../format";
import {
  categorizationCounts,
  describeCategorizationProblem,
  type CategorizationCounts,
  type CategorizationProblem,
} from "../categorization/describeCategorization";

// A labelled fact, for the facts tables.
export type Stat = Fact;

// One account's card in the results, in the order someone doing their books
// reads it: which account, what came in and whether it still needs a
// category, whether the balance agrees with the bank, and, folded away, the
// categories and the facts behind the import.
export type GroupSummary = {
  // The account the statement went into: the preset's name.
  title: string;
  // A bank account or a credit card, for the card's icon.
  accountKind: AccountKind;
  // What kind of account, the number the statement prints, and its period,
  // as one caption: "Bank account ending 0505 · 1 Aug to 31 Aug 2026".
  caption: string;
  closing: ClosingBalance;
  // Folded under "Details": where the rows that were not new went (empty
  // when everything was new), then the files and what Google Pay named.
  notNew: Stat[];
  details: Stat[];
} & (
  | {
      kind: "new";
      fresh: number;
      // "of 8 in the statement" when some of its rows were already in the
      // books; null when every row was new.
      outOf: string | null;
      categories: CategorizationCounts;
      // Why the LLM left some uncategorized; null when it answered for all.
      problem: CategorizationProblem | null;
      // Folded under "By category": how many each account was given.
      byCategory: Stat[];
    }
  | {
      kind: "nothing-new";
      // "Nothing new: 6 transactions already in your books."
      text: string;
    }
);

// The statement's closing balance, and whether it agreed with the books.
export type ClosingBalance =
  | { verified: true; label: string; figure: string }
  | { verified: false; label: string; text: string };

function caption(
  group: AutoImportGroupResult,
  sources: readonly AutoImportPlanFile[],
): string {
  const endings = Array.from(
    new Set(
      sources
        .filter(
          (row): row is Extract<AutoImportPlanFile, { status: "resolved" }> =>
            row.status === "resolved" &&
            group.file_names.includes(row.file_name),
        )
        .map((row) => row.account)
        .filter(
          (account): account is NonNullable<typeof account> => account !== null,
        )
        .map((account) => maskIdentifier(account.identifier)),
    ),
  );
  const kind =
    accountKindOf(group.is_credit_card) === "card"
      ? "Credit card"
      : "Bank account";
  const period = group.result.statement_period;
  return [
    endings.length === 0 ? kind : `${kind} ${joinNames(endings)}`,
    period ? formatDateRange(period) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function notNew(group: AutoImportGroupResult): Stat[] {
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

// Only the closing balance: it is the one a bank shows, and the import
// checked the statement against it.
function closing(group: AutoImportGroupResult): ClosingBalance {
  const { effective } = group.result.balance_metadata.closing;
  const period = group.result.statement_period;
  if (effective === null) {
    return {
      verified: false,
      label: "Closing balance",
      text: "Not checked: the statement prints none",
    };
  }
  return {
    verified: true,
    label: period
      ? `Closing balance, ${formatShortDate(period.last_date)}`
      : "Closing balance",
    figure: formatBalance(effective, accountKindOf(group.is_credit_card)),
  };
}

function details(group: AutoImportGroupResult): Stat[] {
  const { file_names: files } = group;
  const rows: Stat[] = [
    {
      label: files.length === 1 ? "File" : "Files",
      value: joinNames(files),
      face: "words",
    },
  ];
  const named = group.result.gpay_enriched_count;
  if (named > 0) {
    rows.push({ label: "Named from Google Pay", value: String(named) });
  }
  return rows;
}

// `sources` are the batch's file rows; only the ones for this group's files
// are read, for the account number the statement prints.
export function describeGroup(
  group: AutoImportGroupResult,
  sources: readonly AutoImportPlanFile[] = [],
): GroupSummary {
  const r = group.result;
  const common = {
    title: group.preset_name,
    accountKind: accountKindOf(group.is_credit_card),
    caption: caption(group, sources),
    closing: closing(group),
    notNew: notNew(group),
    details: details(group),
  };
  const fresh = r.draft_transaction_count;
  if (fresh === 0) {
    return {
      ...common,
      kind: "nothing-new",
      text:
        r.transaction_count === 0
          ? "The statement has no transactions."
          : `Nothing new: ${plural(r.transaction_count, "transaction")} already in your books.`,
    };
  }
  return {
    ...common,
    kind: "new",
    fresh,
    outOf:
      r.transaction_count === fresh
        ? null
        : `of ${r.transaction_count} in the statement`,
    categories: categorizationCounts(r.categorization_tally),
    problem:
      r.categorization === null
        ? null
        : describeCategorizationProblem(r.categorization),
    byCategory: r.categorization_tally.accounts.map((account) => ({
      label: account.account_name,
      value: String(account.count),
    })),
  };
}
