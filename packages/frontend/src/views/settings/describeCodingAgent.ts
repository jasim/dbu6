import {
  CODING_AGENT_LABEL,
  type CodingAgentSettings,
  type CodingAgentStatus,
} from "dbu6-shared";

// What Settings says under the agent picker: whether dbu6's AI works on this
// machine and on which models, and if not, the one thing to do.
export interface CodingAgentState {
  tone: "ok" | "attention";
  text: string;
  /** A command to run in a terminal, shown after the text. */
  command?: string;
  /** Lines under the text: the models, and the ones that didn't answer. */
  details: string[];
  /** The models were checked, so the user can ask for another check. */
  checkAgain: boolean;
}

const SIGN_IN_COMMAND = {
  "claude-code": "claude",
  codex: "codex login",
} as const;

function activeAgent(
  settings: CodingAgentSettings,
): CodingAgentStatus | undefined {
  return settings.agents.find((a) => a.agent === settings.active);
}

/** The active agent's models are being checked, which takes a few seconds. */
export function checkingModels(settings: CodingAgentSettings): boolean {
  return activeAgent(settings)?.models.state === "checking";
}

export function describeCodingAgent(
  settings: CodingAgentSettings,
): CodingAgentState {
  const active = activeAgent(settings);
  if (active === undefined) {
    return {
      tone: "attention",
      text: "No coding agent found. Without one, dbu6 can't categorize transactions, read new bank statements, or fix import problems. Install Claude Code or Codex on this machine, then reload.",
      details: [],
      checkAgain: false,
    };
  }
  const label = CODING_AGENT_LABEL[active.agent];
  if (!active.logged_in) {
    return {
      tone: "attention",
      text: `${label} isn't signed in. Run this in a terminal, then reload:`,
      command: SIGN_IN_COMMAND[active.agent],
      details: [],
      checkAgain: false,
    };
  }
  const { models } = active;
  switch (models.state) {
    case "not_checked":
    case "checking":
      return {
        tone: "ok",
        text: `Connected to ${label}. Checking which models it can use…`,
        details: [],
        checkAgain: false,
      };
    case "ready": {
      const { session, categorization } = models;
      return {
        tone: "ok",
        text: `Connected to ${label}. It categorizes transactions, reads new bank statements, fixes import problems, and answers questions about your data.`,
        details: [
          session.model === categorization.model
            ? `${label} sessions and categorization run on ${session.label}.`
            : `${label} sessions run on ${session.label}, and categorization on ${categorization.label}.`,
          ...models.unavailable.map(
            (model) => `${model.label} isn't available: ${model.reason}`,
          ),
        ],
        checkAgain: true,
      };
    }
    case "no_model":
      return {
        tone: "attention",
        text: `${label} didn't answer on ${models.unavailable.map((model) => model.label).join(" or ")}, and dbu6 doesn't use less capable models. Until one answers, dbu6 can't categorize transactions, read new bank statements, or fix import problems.`,
        details: models.unavailable.map(
          (model) => `${model.label}: ${model.reason}`,
        ),
        checkAgain: true,
      };
  }
}
