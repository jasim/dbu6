import type { NamedAccount, PostingCheck } from "../../shared/index";
import { agree, plural } from "../format";

/*
 * What a posting check says, in the words every screen shares (PLAN.md §11
 * P1, P3): Overview's rows, the Duplicates and Balance checks tabs, the
 * button's waiting reason, Update's card and the agent prompts. A screen that
 * frames a check its own way keeps its sentence: Update's "possible duplicate
 * entries", the picker's "12 need an account", the button's "12 still need an
 * account".
 */

/** "12 transactions need an account" */
export function uncategorisedText(count: number): string {
  return `${plural(count, "transaction")} ${agree(count, "needs", "need")} an account`;
}

/**
 * "1 transaction goes to the account it came from": a draft categorized to
 * its own statement's account, which needs the other side instead.
 */
export function onOwnAccountText(count: number): string {
  return `${plural(count, "transaction")} ${agree(count, "goes", "go")} to the account it came from`;
}

/** "2 possible duplicates" */
export function duplicatesText(count: number): string {
  return plural(count, "possible duplicate");
}

/** "3 balance checks fail" */
export function failingChecksText(count: number): string {
  return `${plural(count, "balance check")} ${agree(count, "fails", "fail")}`;
}

/**
 * "Waits on HDFC Savings", for drafts whose balance checks count that
 * account's drafts: Review's Add all adds them with it, once it is ready.
 */
export function waitsOnText(accounts: readonly NamedAccount[]): string {
  return `Waits on ${accountsText(accounts)}`;
}

/** "HDFC Savings", "HDFC Savings and ICICI Card". */
export function accountsText(accounts: readonly NamedAccount[]): string {
  const names = accounts.map((account) => account.name);
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A check in one line, whether it passes, blocks, or has nothing to check. */
export function checkText(check: PostingCheck): string {
  switch (check.kind) {
    case "categorization":
      if (check.state === "blocks") {
        return check.on_own_account > 0
          ? onOwnAccountText(check.on_own_account)
          : uncategorisedText(check.count);
      }
      return check.drafts === 1
        ? "The transaction goes to an account"
        : `All ${check.drafts} transactions go to an account`;
    case "duplicates":
      return check.state === "blocks"
        ? duplicatesText(check.count)
        : "No possible duplicates";
    case "balance-checks":
      switch (check.state) {
        case "none":
          return "These drafts have no balance checks";
        case "passes":
          return "Your books agree with the bank";
        case "blocks":
          // Only the posting gate's refusal names the accounts.
          return check.relies_on.length > 0
            ? waitsOnText(check.relies_on)
            : failingChecksText(check.count);
      }
  }
}
