import type {
  AutoImportPlanFile,
  AutoImportResult,
  StatementAccount,
} from "dbu6-shared";
import type { StatusTone } from "../../components/status-chip";
import { problemTone, type ProblemTone } from "./describeProblems";
import type { ImportOutcome } from "./outcome";
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
    const from = `From ${plural(statements, "statement")}.`;
    return {
      tone: "ok",
      text: `${plural(fresh, "new transaction")} imported`,
      next:
        remaining === 0
          ? `${from} All are categorized.`
          : `${from} ${remaining} ${agree(remaining, "needs", "need")} a category before ${agree(remaining, "it", "they")} can go into your books.`,
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
      return {
        tone,
        text:
          total === 1
            ? "Sorry, unable to import transactions."
            : `Sorry, unable to import transactions. ${stuck} of ${plural(total, "file")} need${stuck === 1 ? "s" : ""} a fix.`,
        next: null,
      };
    }
    case "account-refused": {
      const { refusal } = failure;
      const imported = refusal.imported_groups ?? [];
      const failed = refusal.failed_group.preset_name;
      if (imported.length === 0) {
        return {
          tone,
          text: "Sorry, unable to import transactions.",
          next: null,
        };
      }
      const done = joinNames(imported.map((one) => one.preset_name));
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
      return {
        tone,
        text: "Sorry, unable to import transactions.",
        next: null,
      };
  }
}

export interface FileStatus {
  tone: StatusTone;
  text: string;
}

/**
 * What the server read a file as: the bank, the account, and the account
 * it goes to when one is set up. Null when it couldn't read the file.
 */
export function describeStatement(row: AutoImportPlanFile): string | null {
  switch (row.status) {
    case "resolved":
      return `${statementOf(row.institution ?? row.preset_name, row.account)} → ${row.preset_name}`;
    case "unresolved":
      return row.institution === null && row.account === null
        ? null
        : statementOf(row.institution, row.account);
    case "unrecognized":
    case "ambiguous":
      return null;
  }
}

function statementOf(
  bank: string | null,
  account: StatementAccount | null,
): string {
  const whose = account ? describeStatementAccount(account) : null;
  if (bank === null) return whose ? `Statement for ${whose}` : "Statement";
  return whose ? `${bank} statement, ${whose}` : `${bank} statement`;
}

// The one line under a file name once the server has looked at it, for a
// file no problem sits under. A problem's own file shows the problem.
export function describeFileStatus(
  row: AutoImportPlanFile,
  outcome: {
    importedFiles: ReadonlySet<string>;
    // The files of the account whose import failed, that problem's tone,
    // and the file it sits under.
    failed: {
      files: ReadonlySet<string>;
      tone: ProblemTone;
      host: string | null;
    } | null;
  },
): FileStatus {
  switch (row.status) {
    case "resolved": {
      const what = describeStatement(row);
      if (outcome.importedFiles.has(row.file_name)) {
        return { tone: "ok", text: `${what} · Imported` };
      }
      const { failed } = outcome;
      if (failed?.files.has(row.file_name)) {
        return {
          tone: failed.tone,
          text:
            failed.host === null
              ? `${what} · Not imported`
              : `${what} · Not imported, see ${failed.host}`,
        };
      }
      return { tone: "waiting", text: `${what} · Ready` };
    }
    case "unrecognized":
      return { tone: "attention", text: "Format not recognized" };
    case "ambiguous":
      return { tone: "attention", text: "More than one parser matches" };
    case "unresolved":
      return { tone: "attention", text: "No account set up" };
  }
}
