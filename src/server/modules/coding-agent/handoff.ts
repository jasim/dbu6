import { join } from "node:path";
import type {
  AgentHandoff,
  AgentHandoffAvailability,
  CodingAgent,
} from "../../../shared/index.js";
import {
  CodingAgentNotInstalledError,
  HandoffUnsupportedError,
  NoAgentModelError,
  NoCodingAgentError,
  PromptTooLongError,
  TerminalOpenFailedError,
} from "./errors.js";
import { agentModels, currentCodingAgent } from "./models.js";
import {
  agentSessionMode,
  startSession,
  type AgentSessionRefusal,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Hands a prompt the app offers to copy to the coding agent dbu6 uses
 * (agents.ts), as an interactive session the user carries on in a terminal.
 *
 *   handOffPrompt(prompt)
 *     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.md       the prompt
 *     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.command  its launcher
 *     -> on macOS: a new window of the user's terminal app runs it
 *
 * Nuabase writes both and opens the terminal (nuabase.ts): it knows each CLI's
 * options and how to pass a prompt to it safely. The server decides
 * which agent, which model and whether it can open a terminal, and says so in
 * what it returns; the browser sends a prompt and nothing else. The session
 * runs on the most capable model the agent answered on (models.ts), in its
 * auto mode: its reviewer, not the user, approves edits and commands, and
 * stops risky ones. Taking the prompt text from the browser is still
 * acceptable: only a workflow user can post one, and the session runs in a
 * terminal in front of the user, who can stop it. tmp/ is gitignored; no file
 * is ever deleted.
 */

const PROMPTS_DIR = ["tmp", "agent-prompts"] as const;

/**
 * Pure: how a prompt can be handed to this agent on this platform, as
 * nuabase's agentSessionMode says.
 */
export function handoffAvailability(
  agent: InstalledAgent | null,
  platform: NodeJS.Platform,
): AgentHandoffAvailability {
  const mode = agentSessionMode(platform);
  if (agent === null || mode === "none") return { mode: "none" };
  return { mode, agent: agent.agent };
}

/** How a prompt would be handed off now, for the screens' buttons. */
export async function agentHandoffAvailability(
  platform: NodeJS.Platform,
): Promise<AgentHandoffAvailability> {
  return handoffAvailability((await currentCodingAgent()).agent, platform);
}

/**
 * Writes the prompt and its launcher, and on macOS opens a terminal window
 * running it. Throws a `CodingAgentError` when the prompt can't be handed off.
 */
export async function handOffPrompt(
  prompt: string,
  platform: NodeJS.Platform,
  root: string,
): Promise<AgentHandoff> {
  const inUse = await currentCodingAgent();
  if (inUse.agent === null) throw new NoCodingAgentError(inUse.why);
  const { agent } = inUse;
  // At startup the check may still be running; it takes a few seconds.
  const models = await agentModels(agent);
  if (models.state === "no_model") {
    throw new NoAgentModelError(agent.agent, models.unavailable);
  }

  const started = await startSession({
    agent,
    // Pi names no model, so it runs its own configured default.
    model: models.session.model,
    cwd: root,
    prompt,
    dir: join(root, ...PROMPTS_DIR),
    platform,
  });
  switch (started.kind) {
    case "refused":
      throw refusalError(started.reason, agent.agent);
    case "open_failed":
      throw new TerminalOpenFailedError(started.error, started.files.command);
    case "opened":
    case "command": {
      const { files } = started;
      return {
        agent: agent.agent,
        mode: started.kind === "opened" ? "terminal" : "command",
        prompt_path: files.promptPath,
        launcher_path: files.launcherPath,
        command: files.command,
      };
    }
  }
}

function refusalError(reason: AgentSessionRefusal, agent: CodingAgent) {
  switch (reason) {
    case "unsupported_platform":
      return new HandoffUnsupportedError(agent);
    case "prompt_too_long":
      return new PromptTooLongError(agent);
    case "agent_not_found":
      return new CodingAgentNotInstalledError(agent);
  }
}
