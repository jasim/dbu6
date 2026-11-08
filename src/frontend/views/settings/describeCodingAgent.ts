import {
  CODING_AGENTS,
  codingAgentInUse,
  noAgentModelMessage,
  noCodingAgentMessage,
  WHY_A_CODING_AGENT,
  type CodingAgentSettings,
  type CodingAgentStatus,
} from "../../../shared/index";

// What the Coding agent page says under the agents' table: nothing while the
// agent in use works, else the one thing to do. The table itself shows each
// agent's state and models.
export interface CodingAgentState {
  tone: "ok" | "attention";
  /** Null when the table says it all. */
  text: string | null;
  /** A subtler line under the text, saying why it matters. */
  caption?: string;
  /** A command to run in a terminal, shown after the text. */
  command?: string;
  /** Lines under the text: the models that didn't answer, and why. */
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
    if (why.kind === "none_works") {
      return {
        tone: "attention",
        text: noCodingAgentMessage(why),
        caption: WHY_A_CODING_AGENT,
        details: settings.agents.flatMap((status) => {
          const reason = status.installed ? whyNotUsable(status) : null;
          return reason === null ? [] : [reason];
        }),
        checkAgain: true,
      };
    }
    return {
      tone: "attention",
      text: `${noCodingAgentMessage(why)} Until then, dbu6 can't ${AGENT_JOBS}.`,
      details: [],
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
      return { tone: "ok", text: null, details: [], checkAgain: false };
    case "ready":
      return {
        tone: "ok",
        text: null,
        details: models.unavailable.map(
          (model) => `${model.label} isn't available: ${model.reason}`,
        ),
        checkAgain: true,
      };
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

/**
 * A value in a status column and the ink it is drawn in: one agent's on the
 * Coding agent page, each page's on Settings' index.
 */
export interface StatusCell {
  tone: "ok" | "attention" | "quiet" | "plain";
  text: string;
}

export function agentStatusCell(status: CodingAgentStatus): StatusCell {
  if (!status.installed) return { tone: "quiet", text: "Not installed" };
  if (!status.logged_in) return { tone: "attention", text: "Not signed in" };
  switch (status.models.state) {
    case "not_checked":
      return { tone: "quiet", text: "Not checked" };
    case "checking":
      return { tone: "quiet", text: "Checking…" };
    case "ready":
      return { tone: "ok", text: "Ready" };
    case "no_model":
      return { tone: "attention", text: "No model answers" };
  }
}

/**
 * The agent in use and whether it works, as Settings' index shows it in its
 * value column: "Claude Code" when it works, else what is wrong.
 */
export function summarizeCodingAgent(
  settings: CodingAgentSettings,
): StatusCell {
  if (settings.picking) return { tone: "quiet", text: "Checking…" };
  const inUse = codingAgentInUse(settings.agents, settings.chosen);
  if (inUse.agent === null) {
    switch (inUse.why.kind) {
      case "none_installed":
        return { tone: "attention", text: "None installed" };
      case "none_works":
        return { tone: "attention", text: "Not configured" };
      case "chosen_missing":
        return {
          tone: "attention",
          text: `${CODING_AGENTS[inUse.why.chosen].label} not installed`,
        };
    }
  }
  const label = CODING_AGENTS[inUse.agent.agent].label;
  const cell = agentStatusCell(inUse.agent);
  return cell.tone === "ok"
    ? { tone: "ok", text: label }
    : { tone: cell.tone, text: `${label}: ${cell.text.toLowerCase()}` };
}
