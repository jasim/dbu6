import type { AutoImportPlanFile, AutoImportResult } from "dbu6-shared";
import type { StatusTone } from "../../components/status-chip";
import { problemTone, type ProblemTone } from "./describeProblems";
import type { ImportOutcome } from "./outcome";
import { describeStatementAccount, joinNames, plural } from "../../format";

// The sentence at the top of the outcome, in the tone of what happened: ok
// when something new came in, waiting when nothing did, and the problem's
// tone when the import stopped.
export interface BatchSummary {
  tone: StatusTone;
  text: string;
  // What to do about it, under the sentence. Null when nothing needs doing.
  next: string | null;
}

// The transactions an import brought in, across every account.
export function newTransactionCount(result: AutoImportResult): number {
  return result.groups.reduce(
    (sum, group) => sum + group.result.draft_transaction_count,
    0,
  );
}

const FILES_KEPT =
  "Your files are still in the list above. Once this is sorted out, import them again.";

export function describeBatch(outcome: ImportOutcome): BatchSummary {
  if (outcome.kind === "imported") {
    const { result } = outcome;
    const fresh = newTransactionCount(result);
    const statements = plural(result.files.length, "statement");
    const accounts = plural(result.groups.length, "account");
    if (fresh === 0) {
      return {
        tone: "waiting",
        text: `${statements} imported for ${accounts}. Everything in them was already in your books.`,
        next: null,
      };
    }
    return {
      tone: "ok",
      text: `${statements} imported into ${accounts}. ${plural(fresh, "new transaction")} to review.`,
      next: null,
    };
  }
  const { failure } = outcome;
  const tone = problemTone(failure);
  switch (failure.kind) {
    case "files-unresolved": {
      const stuck = failure.files.filter(
        (row) => row.status !== "resolved",
      ).length;
      return {
        tone,
        text: `Nothing was imported. ${stuck} of ${plural(failure.files.length, "file")} need${stuck === 1 ? "s" : ""} attention below.`,
        next: FILES_KEPT,
      };
    }
    case "account-refused": {
      const { refusal } = failure;
      const imported = refusal.imported_groups ?? [];
      const failed = refusal.failed_group.preset_name;
      if (imported.length === 0) {
        return {
          tone,
          text: `Nothing was imported. ${failed} failed, see below.`,
          next: FILES_KEPT,
        };
      }
      const done = joinNames(imported.map((one) => one.preset_name));
      const removed = imported.flatMap((one) => one.file_names);
      return {
        tone,
        text: `${done} ${imported.length === 1 ? "was" : "were"} imported. ${failed} failed, see below.`,
        next: `${joinNames(removed)} ${removed.length === 1 ? "has" : "have"} been taken out of the list above. Fix the problem below and import the rest.`,
      };
    }
    case "network":
    case "forbidden":
    case "unexpected":
      return { tone, text: "Nothing was imported.", next: FILES_KEPT };
  }
}

export interface FileStatus {
  tone: StatusTone;
  text: string;
}

// The one line under a file name once the server has looked at it.
export function describeFileStatus(
  row: AutoImportPlanFile,
  outcome: {
    importedFiles: ReadonlySet<string>;
    // The files of the account whose import failed, and that problem's tone.
    failed: { files: ReadonlySet<string>; tone: ProblemTone } | null;
  },
): FileStatus {
  switch (row.status) {
    case "resolved": {
      const bank = row.institution ?? row.preset_name;
      const account = row.account
        ? `, ${describeStatementAccount(row.account)}`
        : "";
      const what = `${bank} statement${account} → ${row.preset_name}`;
      if (outcome.importedFiles.has(row.file_name)) {
        return { tone: "ok", text: `${what} · Imported` };
      }
      if (outcome.failed?.files.has(row.file_name)) {
        return {
          tone: outcome.failed.tone,
          text: `${what} · Not imported, see below`,
        };
      }
      return { tone: "waiting", text: `${what} · Ready` };
    }
    case "unrecognized":
      return { tone: "attention", text: "Not recognised, see below" };
    case "ambiguous":
      return {
        tone: "attention",
        text: "Recognised by more than one reader, see below",
      };
    case "unresolved":
      return {
        tone: "attention",
        text: "Recognised, but no account is set up for it, see below",
      };
  }
}
