import type { AutoImportPlanFile, AutoImportResult } from "dbu6-shared";
import type { AutoImportError } from "./describeProblems";
import { joinNames, maskIdentifier, plural } from "./format";

// The one sentence at the top of the result view.
export interface BatchSummary {
  tone: "success" | "nothing-new" | "failure" | "partial";
  text: string;
  // Present after a partial import: the files already taken out of the list.
  removedFiles: string[];
}

export function describeBatch(input: {
  result: AutoImportResult | null;
  error: AutoImportError | null;
}): BatchSummary | null {
  const { result, error } = input;
  if (result) {
    const fresh = result.groups.reduce(
      (sum, group) => sum + group.result.draft_transaction_count,
      0,
    );
    const statements = plural(result.files.length, "statement");
    const accounts = plural(result.groups.length, "account");
    if (fresh === 0) {
      return {
        tone: "nothing-new",
        text: `${statements} processed for ${accounts}. Everything in them was already in your books.`,
        removedFiles: [],
      };
    }
    return {
      tone: "success",
      text: `${statements} imported into ${accounts}. ${plural(fresh, "new transaction")} to review.`,
      removedFiles: [],
    };
  }
  if (!error) return null;
  if (error.error === "auto_import_files_unresolved") {
    const stuck = error.files.filter((row) => row.status !== "resolved").length;
    return {
      tone: "failure",
      text: `Nothing was imported. ${stuck} of ${plural(error.files.length, "file")} need${stuck === 1 ? "s" : ""} attention below.`,
      removedFiles: [],
    };
  }
  if (error.importedGroups.length > 0) {
    const done = joinNames(error.importedGroups.map((one) => one.preset_name));
    const failed = error.failedGroup?.preset_name ?? "another account";
    return {
      tone: "partial",
      text: `${done} ${error.importedGroups.length === 1 ? "was" : "were"} imported. ${failed} failed, see below.`,
      removedFiles: error.importedGroups.flatMap((one) => one.file_names),
    };
  }
  if (error.failedGroup) {
    return {
      tone: "failure",
      text: `Nothing was imported. ${error.failedGroup.preset_name} failed, see below.`,
      removedFiles: [],
    };
  }
  return { tone: "failure", text: "Nothing was imported.", removedFiles: [] };
}

export interface FileStatus {
  tone: "ok" | "problem" | "pending";
  text: string;
}

// The one line under a file name once the server has looked at it.
export function describeFileStatus(
  row: AutoImportPlanFile,
  outcome: {
    importedFiles: ReadonlySet<string>;
    failedFiles: ReadonlySet<string>;
  },
): FileStatus {
  switch (row.status) {
    case "resolved": {
      const bank = row.institution ?? row.preset_name;
      const account = row.account
        ? `, ${row.account.kind === "card" ? "card" : "account"} ${maskIdentifier(row.account.identifier)}`
        : "";
      const what = `${bank} statement${account} → ${row.preset_name}`;
      if (outcome.importedFiles.has(row.file_name)) {
        return { tone: "ok", text: `${what} · Imported` };
      }
      if (outcome.failedFiles.has(row.file_name)) {
        return { tone: "problem", text: `${what} · Not imported, see below` };
      }
      return { tone: "pending", text: `${what} · Ready` };
    }
    case "unrecognized":
      return { tone: "problem", text: "Not recognised, see below" };
    case "ambiguous":
      return {
        tone: "problem",
        text: "Recognised by more than one reader, see below",
      };
    case "unresolved":
      return {
        tone: "problem",
        text: "Recognised, but no account is set up for it, see below",
      };
  }
}
