import type { AddProgress, LlmStatus } from "../../shared/index";

/*
 * What the importing card lists while an add runs, from the server's latest
 * word on it (`addProgress`): the steps in the order they happen, each
 * done, running or still to come, with its figures once it has them.
 */

export type ImportingStepState = "done" | "running" | "waiting";

export interface ImportingStep {
  label: string;
  state: ImportingStepState;
  /** "34 of 176 categorized"; absent until the step has figures. */
  detail?: string;
}

// The steps in order; `ask` only when a coding agent can be asked.
type StepKey = "account" | "rules" | "ask" | "save";

/**
 * The steps, given the progress (null before the server has any: the add
 * is still setting the account up) and who categorizes.
 */
export function importingSteps(
  progress: AddProgress | null,
  categorizer: LlmStatus,
): ImportingStep[] {
  const stage = progress?.stage ?? "account";
  const rules = progress?.rules ?? null;
  const llm = progress?.llm ?? null;
  // The rules left nothing for the agent: nothing to ask.
  const nothingToAsk =
    rules !== null && rules.matched === rules.transactions && llm === null;

  const reached: Record<StepKey, number> = {
    account: 0,
    rules: 1,
    ask: 2,
    save: 3,
  };
  // The step running now; the rules run in an instant, so once they have
  // answered the agent is being asked, or the drafts saved.
  const at: StepKey =
    stage === "account"
      ? "account"
      : stage === "saving"
        ? "save"
        : categorizer.ready && !nothingToAsk
          ? "ask"
          : "save";
  const state = (key: StepKey): ImportingStepState =>
    reached[key] < reached[at]
      ? "done"
      : reached[key] === reached[at]
        ? "running"
        : "waiting";

  const steps: ImportingStep[] = [
    { label: "Set up the account", state: state("account") },
    {
      label: "Apply your rules",
      state: state("rules"),
      detail:
        rules === null
          ? undefined
          : `${rules.matched} of ${rules.transactions} categorized`,
    },
  ];
  if (categorizer.ready) {
    steps.push({
      label: `Ask ${categorizer.name}`,
      state: state("ask"),
      detail: nothingToAsk
        ? "Nothing left to ask"
        : llm === null
          ? undefined
          : `${llm.answered} of ${llm.descriptions} descriptions answered`,
    });
  }
  steps.push({ label: "Save as drafts", state: state("save") });
  return steps;
}

/** "0:07", "1:42", "12:05": time since the add started. */
export function elapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
