import {
  CODING_AGENTS,
  codingAgentInUse,
  noAgentModelMessage,
  noCodingAgentMessage,
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
  /**
   * Nothing is being checked, so the user can ask dbu6 to detect the agents
   * and check their models again. dbu6 does neither on its own once it has.
   */
  checkAgain: boolean;
}

// What dbu6 needs a coding agent for, said once.
const AGENT_JOBS =
  "categorize transactions, read new bank statements, or fix import problems";

/**
 * dbu6 is picking an agent, or the chosen one's models are being checked:
 * either takes a few seconds.
 */
export function checkingModels(settings: CodingAgentSettings): boolean {
  if (settings.picking) return true;
  const inUse = codingAgentInUse(settings.agents, settings.chosen);
  return inUse.agent?.models.state === "checking";
}

// Why an installed agent can't be used, for the list under "none works".
function whyNotUsable(status: CodingAgentStatus): string | null {
  const label = CODING_AGENTS[status.agent].label;
  if (!status.logged_in) {
    return `${label} isn't signed in: run ${CODING_AGENTS[status.agent].signInCommand} in a terminal.`;
  }
  return status.models.state === "no_model"
    ? noAgentModelMessage(status.agent, status.models.unavailable)
    : null;
}

export function describeCodingAgent(
  settings: CodingAgentSettings,
): CodingAgentState {
  if (settings.picking) {
    return {
      tone: "ok",
      text: "Looking for a coding agent that works…",
      details: [],
      checkAgain: false,
    };
  }
  const inUse = codingAgentInUse(settings.agents, settings.chosen);
  if (inUse.agent === null) {
    const { why } = inUse;
    return {
      tone: "attention",
      text: `${noCodingAgentMessage(why)} Until then, dbu6 can't ${AGENT_JOBS}.`,
      details:
        why.kind === "none_works"
          ? settings.agents.flatMap((status) => {
              const reason = status.installed ? whyNotUsable(status) : null;
              return reason === null ? [] : [reason];
            })
          : [],
      checkAgain: true,
    };
  }
  const active = inUse.agent;
  const label = CODING_AGENTS[active.agent].label;
  if (!active.logged_in) {
    return {
      tone: "attention",
      text: `${label} isn't signed in. Run this in a terminal, then check again:`,
      command: CODING_AGENTS[active.agent].signInCommand,
      details: [],
      checkAgain: true,
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
