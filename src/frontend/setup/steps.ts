import type { SetupStatus } from "../../shared/index";
import { plural } from "../format";

/*
 * The setup wizard's four steps. Each one's state comes from the books,
 * never from the wizard: the chart is done once there is any account; the
 * banks and cards once any account is set up for statements; the first
 * statements once every bank or card has transactions; and Review once
 * those are in and no drafts remain.
 */

export const SETUP_ROUTE = "/setup";

export type SetupStepId = "accounts" | "banks" | "statements" | "review";

export const SETUP_STEP_ROUTES: Record<SetupStepId, string> = {
  accounts: `${SETUP_ROUTE}/accounts`,
  banks: `${SETUP_ROUTE}/banks`,
  statements: `${SETUP_ROUTE}/statements`,
  review: `${SETUP_ROUTE}/review`,
};

const ORDER: readonly SetupStepId[] = [
  "accounts",
  "banks",
  "statements",
  "review",
];

const TITLES: Record<SetupStepId, string> = {
  accounts: "Chart of accounts",
  banks: "Banks & cards",
  statements: "First statements",
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
    case "review":
      return stepDone("statements", status) && status.drafts === 0;
  }
}

/**
 * Where `/setup` opens: the first step not done, else Review, which then
 * says the books are set up.
 */
export function firstOpenStep(status: SetupStatus): SetupStepId {
  return ORDER.find((id) => !stepDone(id, status)) ?? "review";
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

/** The rail's four steps, `current` being the one on screen. */
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
    case "review":
      if (stepDone("review", status)) return "Done";
      return status.drafts > 0 ? `${status.drafts} to review` : "Nothing yet";
  }
}
