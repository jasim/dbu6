import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentHandoff, AgentHandoffAvailability } from "dbu6-shared";
import { CODING_AGENT_RUN, currentCodingAgent } from "./agents.js";
import {
  HandoffUnsupportedError,
  NoAgentModelError,
  NoCodingAgentError,
  PromptTooLongError,
  TerminalOpenFailedError,
} from "./errors.js";
import { launcherCommand, launcherScript } from "./launcher.js";
import { agentModels } from "./models.js";
import type { InstalledAgent } from "./nuabase.js";

/*
 * Hands a prompt the app offers to copy to the coding agent dbu6 uses
 * (agents.ts), as an interactive session the user carries on in a terminal.
 *
 *   handOffPrompt(prompt)
 *     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.md       the prompt, 0600
 *     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.command  the launcher, 0700
 *     -> on macOS: `open <launcher>` runs it in a new window of the user's
 *        terminal app, which needs no Automation permission
 *
 * The server decides which agent, which model and whether it can open a
 * terminal, and says so in what it returns; the browser sends a prompt and
 * nothing else. The session runs on the most capable model the agent answered
 * on (models.ts), in its auto mode (agents.ts): its reviewer, not the user,
 * approves edits and commands, and stops risky ones. Taking the prompt text
 * from the browser is still acceptable: only a workflow user can post one, and
 * the session runs in a terminal in front of the user, who can stop it. tmp/
 * is gitignored; no file is ever deleted.
 */

const PROMPTS_DIR = ["tmp", "agent-prompts"] as const;
// Linux caps one command-line argument at 131072 bytes (MAX_ARG_STRLEN), and
// the launcher passes the whole prompt as one. macOS only caps all arguments
// together, at 1 MiB, above the contract's limit.
const LINUX_MAX_ARGUMENT_BYTES = 131_072;

/**
 * Pure: how a prompt can be handed to this agent on this platform. The
 * launcher is a POSIX shell script, and only macOS can open a terminal window
 * on it without asking for Automation permission.
 */
export function handoffAvailability(
  agent: InstalledAgent | null,
  platform: NodeJS.Platform,
): AgentHandoffAvailability {
  if (agent === null || platform === "win32") return { mode: "none" };
  return {
    mode: platform === "darwin" ? "terminal" : "command",
    agent: agent.agent,
  };
}

/** How a prompt would be handed off now, for the screens' buttons. */
export async function agentHandoffAvailability(
  platform: NodeJS.Platform,
): Promise<AgentHandoffAvailability> {
  return handoffAvailability(await currentCodingAgent(), platform);
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
  const agent = await currentCodingAgent();
  if (agent === null) throw new NoCodingAgentError();
  const availability = handoffAvailability(agent, platform);
  if (availability.mode === "none")
    throw new HandoffUnsupportedError(agent.agent);
  if (
    platform === "linux" &&
    Buffer.byteLength(prompt) >= LINUX_MAX_ARGUMENT_BYTES
  ) {
    throw new PromptTooLongError(agent.agent);
  }
  // At startup the check may still be running; it takes a few seconds.
  const models = await agentModels(agent);
  if (models.state === "no_model") {
    throw new NoAgentModelError(agent.agent, models.unavailable);
  }

  const written = await writeHandoffFiles(
    root,
    agent,
    models.session.model,
    prompt,
  );
  if (availability.mode === "terminal") {
    try {
      await promisify(execFile)("open", [written.launcher_path]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new TerminalOpenFailedError(reason, written.command);
    }
  }
  return { agent: agent.agent, mode: availability.mode, ...written };
}

async function writeHandoffFiles(
  root: string,
  { agent, binaryPath }: InstalledAgent,
  model: string,
  prompt: string,
): Promise<Omit<AgentHandoff, "agent" | "mode">> {
  const dir = join(root, ...PROMPTS_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const name = `${stamp}-${agent}-${randomBytes(2).toString("hex")}`;
  const promptPath = join(dir, `${name}.md`);
  const launcherPath = join(dir, `${name}.command`);
  await writeFile(promptPath, prompt, { mode: 0o600, flag: "wx" });
  await writeFile(
    launcherPath,
    launcherScript({
      projectRoot: root,
      binaryPath,
      agentArgs: ["--model", model, ...CODING_AGENT_RUN[agent].autoModeArgs],
      promptPath,
    }),
    { mode: 0o700, flag: "wx" },
  );
  return {
    prompt_path: promptPath,
    launcher_path: launcherPath,
    command: launcherCommand(launcherPath),
  };
}
