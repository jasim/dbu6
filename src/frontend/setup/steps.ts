import type { SetupStatus } from "../../shared/index";
import type { Step } from "../components/progress-steps";
import { plural } from "../format";
import { OPENING_BALANCES_ROUTE } from "../views/opening-balances/OpeningBalances";

/*
 * The setup wizard's steps. Each one's state comes from the books, never
 * from the wizard: the chart is done once there is any account, the banks
 * and cards once any account is in a preset, and the statement formats once
 * every preset account's is set up. Opening balances is its own screen.
 */

export const SETUP_ROUTE = "/setup";

export type SetupStepId = "accounts" | "banks" | "statements";

export const SETUP_STEP_ROUTES: Record<SetupStepId, string> = {
  accounts: `${SETUP_ROUTE}/accounts`,
  banks: `${SETUP_ROUTE}/banks`,
  statements: `${SETUP_ROUTE}/statements`,
};

function isDone(id: SetupStepId, status: SetupStatus): boolean {
  switch (id) {
    case "accounts":
      return status.accounts > 0;
    case "banks":
      return status.preset_accounts > 0;
    case "statements":
      return (
        status.preset_accounts > 0 &&
        status.ready_accounts === status.preset_accounts
      );
  }
}

/** Where `/setup` opens: the first step not done, else the last. */
export function firstOpenStep(status: SetupStatus): SetupStepId {
  if (!isDone("accounts", status)) return "accounts";
  if (!isDone("banks", status)) return "banks";
  return "statements";
}

/** The four cards across the top of the wizard, `current` being shown. */
export function setupSteps(
  status: SetupStatus | null,
  current: SetupStepId,
): Step[] {
  const state = (id: SetupStepId) =>
    id === current
      ? "current"
      : status !== null && isDone(id, status)
        ? "done"
        : "waiting";
  return [
    {
      title: "Chart of accounts",
      status: state("accounts"),
      detail:
        status && status.accounts > 0
          ? plural(status.accounts, "account")
          : "The accounts your money is sorted into",
      to: SETUP_STEP_ROUTES.accounts,
    },
    {
      title: "Banks and cards",
      status: state("banks"),
      detail:
        status && status.preset_accounts > 0
          ? plural(status.preset_accounts, "bank or card", "banks and cards")
          : "Where your statements come from",
      to: SETUP_STEP_ROUTES.banks,
    },
    {
      title: "Statement formats",
      status: state("statements"),
      detail:
        status && status.preset_accounts > 0
          ? `${status.ready_accounts} of ${status.preset_accounts} ready`
          : "A sample statement for each",
      to: SETUP_STEP_ROUTES.statements,
    },
    {
      title: "Opening balances",
      status: "waiting",
      detail: "What each account held when you start",
      to: OPENING_BALANCES_ROUTE,
    },
  ];
}
