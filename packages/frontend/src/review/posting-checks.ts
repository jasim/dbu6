import type { PostingCheck } from "dbu6-shared";
import { agree, plural } from "../format";

/*
 * What a posting check says, in the words every screen shares (PLAN.md §11
 * P1, P3): Overview's rows, the Duplicates and Balance checks tabs, the
 * button's waiting reason, Home's card and the agent prompts. A screen that
 * frames a check its own way keeps its sentence: Home's "possible duplicate
 * entries", the picker's "12 need a category", the button's "12 still need a
 * category".
 */

/** "12 transactions need a category" */
export function uncategorisedText(count: number): string {
  return `${plural(count, "transaction")} ${agree(count, "needs", "need")} a category`;
}

/** "2 possible duplicates" */
export function duplicatesText(count: number): string {
  return plural(count, "possible duplicate");
}

/** "3 balance checks fail" */
export function failingChecksText(count: number): string {
  return `${plural(count, "balance check")} ${agree(count, "fails", "fail")}`;
}

/** A check in one line, whether it passes, blocks, or has nothing to check. */
export function checkText(check: PostingCheck): string {
  switch (check.kind) {
    case "categories":
      if (check.state === "blocks") return uncategorisedText(check.count);
      return check.drafts === 1
        ? "The transaction has a category"
        : `All ${check.drafts} transactions have a category`;
    case "duplicates":
      return check.state === "blocks"
        ? duplicatesText(check.count)
        : "No possible duplicates";
    case "balance-checks":
      switch (check.state) {
        case "none":
          return "These drafts have no balance checks";
        case "passes":
          return "Every balance check passes";
        case "blocks":
          return failingChecksText(check.count);
      }
  }
}
