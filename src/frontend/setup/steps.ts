import type { SetupStatus } from "../../shared/index";
import { plural } from "../format";

/*
 * The setup wizard's five steps. Each one's state comes from the books,
 * never from the wizard: the chart is done once there is any account; the
 * banks and cards once any account is set up for statements; the first
 * statements once every bank or card has transactions; the other balances
 * once any is recorded; and Review once the statements are in and no
 * drafts remain. Other balances is optional: Review never waits for it.
 */

export const SETUP_ROUTE = "/setup";

export type SetupStepId =
  "accounts" | "banks" | "statements" | "balances" | "review";

export const SETUP_STEP_ROUTES: Record<SetupStepId, string> = {
  accounts: `${SETUP_ROUTE}/accounts`,
  banks: `${SETUP_ROUTE}/banks`,
  statements: `${SETUP_ROUTE}/statements`,
  balances: `${SETUP_ROUTE}/balances`,
  review: `${SETUP_ROUTE}/review`,
};

const ORDER: readonly SetupStepId[] = [
  "accounts",
  "banks",
  "statements",
  "balances",
  "review",
];

const TITLES: Record<SetupStepId, string> = {
  accounts: "Chart of accounts",
  banks: "Banks & cards",
  statements: "First statements",
  balances: "Other balances",
  review: "Review",
};

/** Whether the books have done the step. */
export function stepDone(id: SetupStepId, status: SetupStatus): boolean {
  switch (id) {
    case "accounts":
      return status.accounts > 0;
    case "banks":
      return status.statement_accounts > 0;
    case "statements":
      return (
        status.statement_accounts > 0 &&
        status.imported_accounts === status.statement_accounts
      );
    case "balances":
      return status.other_balances > 0;
    case "review":
      return stepDone("statements", status) && status.drafts === 0;
  }
}

/** The Other balances step, on one account's row (by its name or path). */
export function balancesHref(account: string): string {
  return `${SETUP_STEP_ROUTES.balances}?${new URLSearchParams({ account })}`;
}

/** ✓ done, ● the step shown (not yet done), ○ still to do. */
export type RailMark = "done" | "current" | "todo";

export interface RailStep {
  id: SetupStepId;
  title: string;
  to: string;
  mark: RailMark;
  /** The step on screen. */
  current: boolean;
  /** "72 accounts"; empty until the status has loaded. */
  status: string;
}

/** The rail's five steps, `current` being the one on screen. */
export function railSteps(
  status: SetupStatus | null,
  current: SetupStepId,
): RailStep[] {
  return ORDER.map((id) => {
    const done = status !== null && stepDone(id, status);
    return {
      id,
      title: TITLES[id],
      to: SETUP_STEP_ROUTES[id],
      mark: done ? "done" : id === current ? "current" : "todo",
      current: id === current,
      status: status === null ? "" : statusLine(id, status),
    };
  });
}

function statusLine(id: SetupStepId, status: SetupStatus): string {
  switch (id) {
    case "accounts":
      return status.accounts > 0
        ? plural(status.accounts, "account")
        : "Not created";
    case "banks":
      return status.statement_accounts > 0
        ? `${status.statement_accounts} added`
        : "None yet";
    case "statements":
      return status.statement_accounts > 0
        ? `${status.imported_accounts} of ${status.statement_accounts} imported`
        : "Add a bank or card first";
    case "balances":
      return status.other_balances > 0
        ? `${status.other_balances} recorded`
        : "Optional";
    case "review":
      if (stepDone("review", status)) return "Done";
      return status.drafts > 0 ? `${status.drafts} to review` : "Nothing yet";
  }
}
