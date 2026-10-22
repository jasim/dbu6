import type {
  AutoImportPlanFile,
  AutoImportResult,
  StatementAccount,
} from "../../../shared/index";
import type { StatusTone } from "../../components/status-chip";
import { problemTone, type ProblemTone } from "./describeProblems";
import type { FileCheck, ImportOutcome } from "./outcome";
import {
  agree,
  describeStatementAccount,
  joinNames,
  plural,
} from "../../format";
import { categorizationCounts } from "../categorization/describeCategorization";

// The headline of the outcome, in the tone of what happened: ok when
// something new came in, waiting when nothing did, and the problem's tone
// when the import stopped.
export interface BatchSummary {
  tone: StatusTone;
  text: string;
  // The line under it: where the new transactions came from and what they
  // still need, or what changed in the list above when the import stopped.
  // Null when there is nothing to add: the cards say what went wrong and
  // what to do.
  next: string | null;
}

// The transactions an import brought in, across every account.
export function newTransactionCount(result: AutoImportResult): number {
  return result.groups.reduce(
    (sum, group) => sum + group.result.draft_transaction_count,
    0,
  );
}

export function describeBatch(outcome: ImportOutcome): BatchSummary {
  if (outcome.kind === "imported") {
    const { result } = outcome;
    const fresh = newTransactionCount(result);
    const statements = result.files.length;
    if (fresh === 0) {
      return {
        tone: "waiting",
        text: "Nothing new",
        next:
          statements === 1
            ? "Everything in the statement was already in your books."
            : `Everything in the ${statements} statements was already in your books.`,
      };
    }
    const remaining = result.groups.reduce(
      (sum, group) =>
        sum + categorizationCounts(group.result.categorization_tally).remaining,
      0,
    );
    return {
      tone: "ok",
      text: `${plural(fresh, "new transaction")} imported`,
      next:
        remaining === 0
          ? `All entries categorized.`
          : `${remaining} entries need to be categorized.`,
    };
  }
  const { failure } = outcome;
  const tone = problemTone(failure);
  switch (failure.kind) {
    case "files-unresolved": {
      const total = failure.files.length;
      const stuck = failure.files.filter(
        (row) => row.status !== "resolved",
      ).length;
      // One file's problem says it all; with more, say how many hold the
      // rest up.
      // The files changed between their check and the import: the new
      // presets or parsers moved one. The rows say which.
      return {
        tone,
        text:
          total === 1
            ? "This statement needs setting up first"
            : `${stuck} of ${plural(total, "statement")} need${stuck === 1 ? "s" : ""} setting up first`,
        next: null,
      };
    }
    case "account-refused": {
      const { refusal } = failure;
      const imported = refusal.imported_groups ?? [];
      const failed = refusal.failed_group.account_name;
      if (imported.length === 0) {
        return { tone, text: `${failed} wasn't imported`, next: null };
      }
      const done = joinNames(imported.map((one) => one.account_name));
      const removed = imported.flatMap((one) => one.file_names);
      return {
        tone,
        text: `${done} ${imported.length === 1 ? "was" : "were"} imported. ${failed} wasn't.`,
        next: `${joinNames(removed)} ${removed.length === 1 ? "is" : "are"} done and off the list, so importing again sends only the rest.`,
      };
    }
    case "network":
    case "forbidden":
    case "unexpected":
      return { tone, text: "The import didn't go through", next: null };
  }
}

export interface FileStatus {
  tone: StatusTone;
  text: string;
}

/**
 * A dropped file's status, in a word or two for its row: being read, ready,
 * or the step it needs next. A file the import refused says so.
 */
export function describeFileStatus(
  check: FileCheck,
  // The files of the account whose import failed, and that problem's tone.
  failed: { files: ReadonlySet<string>; tone: ProblemTone } | null,
): FileStatus {
  switch (check.kind) {
    case "reading":
      return { tone: "waiting", text: "Reading…" };
    case "unread":
      return { tone: "problem", text: "Couldn't read" };
    case "read":
      break;
  }
  const { row } = check;
  switch (row.status) {
    case "resolved":
      return failed?.files.has(row.file_name)
        ? { tone: failed.tone, text: "Not imported" }
        : { tone: "ok", text: "Ready" };
    case "unrecognized":
      return { tone: "attention", text: "New format" };
    case "ambiguous":
      return { tone: "attention", text: "Two formats" };
    case "unresolved":
      return {
        tone: "attention",
        text:
          row.reason === "statement_account_identifier_required"
            ? "Account number"
            : "New account",
      };
  }
}

/** The account a read file goes to, or the account it prints when none takes it. */
export function describeFileAccount(row: AutoImportPlanFile): string | null {
  switch (row.status) {
    case "resolved":
      return row.account_name;
    case "unresolved":
      return row.account === null
        ? row.institution
        : [row.institution, describeStatementAccount(row.account)]
            .filter(Boolean)
            .join(" ");
    case "unrecognized":
    case "ambiguous":
      return null;
  }
}

/** How many dropped files are ready, still to set up, or being read, and their rows. */
export interface BatchCounts {
  ready: number;
  setUp: number;
  reading: number;
  unread: number;
  transactions: number;
}

export function countChecks(checks: readonly FileCheck[]): BatchCounts {
  const counts = { ready: 0, setUp: 0, reading: 0, unread: 0, transactions: 0 };
  for (const check of checks) {
    if (check.kind === "reading") counts.reading += 1;
    else if (check.kind === "unread") counts.unread += 1;
    else if (check.row.status === "resolved") {
      counts.ready += 1;
      counts.transactions += check.row.transactions;
    } else counts.setUp += 1;
  }
  return counts;
}
