import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type {
  AgentHandoff,
  AgentHandoffAvailability,
} from "../../../shared/index.js";
import {
  HandoffUnsupportedError,
  NoAgentModelError,
  NoCodingAgentError,
  PromptTooLongError,
  TerminalOpenFailedError,
} from "./errors.js";
import { agentModels, currentCodingAgent } from "./models.js";
import {
  fitsSession,
  openSessionInTerminal,
  sessionMode,
  writeSession,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Hands a prompt the app offers to copy to the coding agent dbu6 uses
 * (agents.ts), as an interactive session the user carries on in a terminal.
 *
 *   handOffPrompt(prompt)
 *     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.md       the prompt, 0600
 *     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.command  the launcher, 0700
 *     -> on macOS: a new window of the user's terminal app runs it
 *
 * Nuabase writes the launcher and opens the terminal (nuabase.ts): it knows
 * each CLI's options and how to pass a prompt to it safely. The server decides
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
 * Pure: how a prompt can be handed to this agent on this platform: nuabase's
 * launcher is a POSIX shell script, and only on macOS can it open a terminal
 * window without asking for Automation permission.
 */
export function handoffAvailability(
  agent: InstalledAgent | null,
  platform: NodeJS.Platform,
): AgentHandoffAvailability {
  const mode = sessionMode(platform);
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
  const availability = handoffAvailability(agent, platform);
  if (availability.mode === "none")
    throw new HandoffUnsupportedError(agent.agent);
  if (!fitsSession(prompt, platform)) {
    throw new PromptTooLongError(agent.agent);
  }
  // At startup the check may still be running; it takes a few seconds.
  const models = await agentModels(agent);
  if (models.state === "no_model") {
    throw new NoAgentModelError(agent.agent, models.unavailable);
  }

  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const written = writeSession({
    agent,
    // Pi names no model, so it runs its own configured default.
    model: models.session.model,
    cwd: root,
    prompt,
    dir: join(root, ...PROMPTS_DIR),
    name: `${stamp}-${agent.agent}-${randomBytes(2).toString("hex")}`,
    platform,
  });
  if (availability.mode === "terminal") {
    try {
      await openSessionInTerminal(written.launcherPath, platform);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TerminalOpenFailedError(reason, written.command);
    }
  }
  return {
    agent: agent.agent,
    mode: availability.mode,
    prompt_path: written.promptPath,
    launcher_path: written.launcherPath,
    command: written.command,
  };
}
