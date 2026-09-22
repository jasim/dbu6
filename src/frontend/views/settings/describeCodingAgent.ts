import {
  CODING_AGENTS,
  NO_CODING_AGENT_MESSAGE,
  noAgentModelMessage,
  type CodingAgentSettings,
  type CodingAgentStatus,
} from "../../../shared/index";

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

// What dbu6 needs a coding agent for, said once.
const AGENT_JOBS =
  "categorize transactions, read new bank statements, or fix import problems";

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
      text: `${NO_CODING_AGENT_MESSAGE} Without one, dbu6 can't ${AGENT_JOBS}. Reload once one is installed.`,
      details: [],
      checkAgain: false,
    };
  }
  const label = CODING_AGENTS[active.agent].label;
  if (!active.logged_in) {
    return {
      tone: "attention",
      text: `${label} isn't signed in. Run this in a terminal, then reload:`,
      command: CODING_AGENTS[active.agent].signInCommand,
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
        text: `${noAgentModelMessage(active.agent, models.unavailable)} Until one answers, dbu6 can't ${AGENT_JOBS}.`,
        details: models.unavailable.map(
          (model) => `${model.label}: ${model.reason}`,
        ),
        checkAgain: true,
      };
  }
}
