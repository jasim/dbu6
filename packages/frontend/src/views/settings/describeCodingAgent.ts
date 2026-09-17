import { CODING_AGENT_LABEL, type CodingAgentSettings } from "dbu6-shared";

// The one line under the agent picker on Settings: whether dbu6's AI works on
// this machine, and if not, the one thing to do.
export interface CodingAgentState {
  tone: "ok" | "attention";
  text: string;
  /** A command to run in a terminal, shown after the text. */
  command?: string;
}

const SIGN_IN_COMMAND = {
  "claude-code": "claude",
  codex: "codex login",
} as const;

export function describeCodingAgent(
  settings: CodingAgentSettings,
): CodingAgentState {
  const active = settings.agents.find((a) => a.agent === settings.active);
  if (active === undefined) {
    return {
      tone: "attention",
      text: "No coding agent found. Without one, dbu6 can't categorize transactions, read new bank statements, or fix import problems. Install Claude Code or Codex on this machine, then reload.",
    };
  }
  const label = CODING_AGENT_LABEL[active.agent];
  if (!active.logged_in) {
    return {
      tone: "attention",
      text: `${label} isn't signed in. Run this in a terminal, then reload:`,
      command: SIGN_IN_COMMAND[active.agent],
    };
  }
  return {
    tone: "ok",
    text: `Connected to ${label}. It categorizes transactions, reads new bank statements, fixes import problems, and answers questions about your data.`,
  };
}
