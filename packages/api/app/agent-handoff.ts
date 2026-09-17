import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { projectRoot, TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  agentHandoffContract,
  CODING_AGENT_LABEL,
  type AgentHandoff,
  type AgentHandoffCapabilities,
  type AgentHandoffErrorBody,
  type AgentHandoffRequest,
  type CodingAgent,
} from "dbu6-shared";
import { launcherCommand, launcherScript } from "../agent-handoff/launcher.js";
import {
  currentCodingAgent,
  NO_CODING_AGENT_MESSAGE,
  type InstalledAgent,
} from "../coding-agent.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Hands a prompt the app offers to copy to the coding agent dbu6 uses on this
// machine (coding-agent.ts), as an interactive session the user carries on in
// a terminal.
//
//   POST { prompt, open }
//     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.md       the prompt, 0600
//     -> tmp/agent-prompts/<stamp>-<agent>-<hex>.command  the launcher, 0700
//     -> on macOS with `open`: `open <launcher>` runs it in a new window of
//        the user's terminal app, which needs no Automation permission
//
// Every edit and command in that session still needs the user's approval, so
// taking the prompt text from the browser is acceptable. tmp/ is gitignored;
// no file is ever deleted.

const PROMPTS_DIR = ["tmp", "agent-prompts"] as const;
// Linux caps one command-line argument at 131072 bytes (MAX_ARG_STRLEN), and the
// launcher passes the whole prompt as one. macOS only caps all arguments
// together, at 1 MiB, above the contract's limit.
const LINUX_MAX_ARGUMENT_BYTES = 131_072;

export function handoffCapabilities(
  agent: CodingAgent | null,
  platform: NodeJS.Platform,
): AgentHandoffCapabilities {
  // The launcher is a POSIX shell script.
  const shellCommand = agent !== null && platform !== "win32";
  return {
    agent,
    open_terminal: shellCommand && platform === "darwin",
    shell_command: shellCommand,
  };
}

export async function agentHandoffCapabilities(
  platform: NodeJS.Platform,
): Promise<AgentHandoffCapabilities> {
  const agent = await currentCodingAgent();
  return handoffCapabilities(agent?.agent ?? null, platform);
}

type HandOffResponse =
  | { status: 200; body: AgentHandoff }
  | { status: 400; body: AgentHandoffErrorBody }
  | { status: 500; body: AgentHandoffErrorBody };

export async function handOffPrompt(
  request: AgentHandoffRequest,
  platform: NodeJS.Platform,
  root: string,
): Promise<HandOffResponse> {
  const target = await currentCodingAgent();
  if (target === null) {
    return {
      status: 400,
      body: {
        error: "no_coding_agent",
        message: NO_CODING_AGENT_MESSAGE,
      },
    };
  }
  const label = CODING_AGENT_LABEL[target.agent];
  const capabilities = handoffCapabilities(target.agent, platform);
  if (!capabilities.shell_command) {
    return {
      status: 400,
      body: {
        error: "agent_handoff_unsupported",
        message: `dbu6 can't start ${label} on this operating system. Copy the prompt instead.`,
      },
    };
  }
  if (
    platform === "linux" &&
    Buffer.byteLength(request.prompt) >= LINUX_MAX_ARGUMENT_BYTES
  ) {
    return {
      status: 400,
      body: {
        error: "prompt_too_long",
        message: `This prompt is too long to start ${label} with on this system. Copy it instead.`,
      },
    };
  }
  if (request.open && !capabilities.open_terminal) {
    return {
      status: 400,
      body: {
        error: "terminal_unavailable",
        message:
          "dbu6 can only open a terminal window on macOS. Ask for the command instead.",
      },
    };
  }

  const handoff = await writeHandoffFiles(root, target, request.prompt);
  if (request.open) {
    try {
      await promisify(execFile)("open", [handoff.launcher_path]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        status: 500,
        body: {
          error: "terminal_open_failed",
          message: `Couldn't open a terminal window (${reason}). Run this in a terminal instead: ${handoff.command}`,
        },
      };
    }
  }
  return { status: 200, body: handoff };
}

async function writeHandoffFiles(
  root: string,
  { agent, binaryPath }: InstalledAgent,
  prompt: string,
): Promise<AgentHandoff> {
  const dir = join(root, ...PROMPTS_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const name = `${stamp}-${agent}-${randomBytes(2).toString("hex")}`;
  const promptPath = join(dir, `${name}.md`);
  const launcherPath = join(dir, `${name}.command`);
  await writeFile(promptPath, prompt, { mode: 0o600, flag: "wx" });
  await writeFile(
    launcherPath,
    launcherScript({ projectRoot: root, binaryPath, promptPath }),
    { mode: 0o700, flag: "wx" },
  );
  return {
    prompt_path: promptPath,
    launcher_path: launcherPath,
    command: launcherCommand(launcherPath),
  };
}

const api = new TsRestApi<SapportaEnv>();

api.register(
  "getAgentHandoffCapabilities",
  agentHandoffContract.getAgentHandoffCapabilities,
  async ({ c }) => {
    requireWorkflowAuth(c);
    return {
      status: 200,
      body: await agentHandoffCapabilities(process.platform),
    };
  },
);

api.register(
  "handOffPrompt",
  agentHandoffContract.handOffPrompt,
  async ({ c, request }) => {
    requireWorkflowAuth(c);
    return handOffPrompt(request.body, process.platform, projectRoot());
  },
);

export default api;
