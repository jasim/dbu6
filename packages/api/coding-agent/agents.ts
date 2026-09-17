import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  CODING_AGENTS,
  codingAgentSchema,
  type AgentModel,
  type CodingAgent,
} from "dbu6-shared";
import { userConfigPath } from "../user-data.js";
import {
  detectAgents,
  type DetectedAgent,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Which coding agent dbu6 uses for everything AI, and how it runs each one.
 * It is the agent chosen in Settings when that one is installed, else the
 * first installed one, Claude Code first. The choice lives in
 * data/user-config/settings.json: the agent belongs to this machine, not to a
 * workspace.
 *
 * What the screens say about an agent — its name, how to sign in — is in
 * dbu6-shared's CODING_AGENTS. Both are keyed by the same agents, so adding
 * one is an entry in each.
 */

/**
 * How dbu6 runs each agent.
 *
 * `models` are the agent's models, most capable first; the last is a floor, so
 * dbu6 never runs the agent on a less capable model. Which of them answer
 * depends on the user's login and plan, which models.ts checks.
 *
 * `autoModeArgs` put an interactive session in the agent's auto mode: its own
 * reviewer approves edits and commands and stops risky ones, so the user
 * answers questions but isn't asked for every step. Codex's auto review keeps
 * it in the workspace-write sandbox. Headless categorization has nothing to
 * approve and takes none of these.
 */
export const CODING_AGENT_RUN = {
  "claude-code": {
    models: [
      { model: "opus", label: "Claude Opus" },
      { model: "sonnet", label: "Claude Sonnet" },
    ],
    autoModeArgs: ["--permission-mode", "auto"],
  },
  codex: {
    models: [
      { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    ],
    autoModeArgs: ["--approve-for-me"],
  },
} as const satisfies Record<
  CodingAgent,
  { models: readonly AgentModel[]; autoModeArgs: readonly string[] }
>;

const DETECTION_TTL_MS = 60_000;

let detection: { at: number; agents: Promise<DetectedAgent[]> } | null = null;

/**
 * Every agent dbu6 knows, Claude Code first, and whether each is installed and
 * logged in. Detection runs each CLI, so it is kept for a minute: an agent
 * installed later shows up without a restart, and a click doesn't wait on the
 * CLIs. `fresh` detects again now, for the Settings screen.
 */
export function detectCodingAgents({
  fresh = false,
}: { fresh?: boolean } = {}): Promise<DetectedAgent[]> {
  const now = Date.now();
  if (fresh || detection === null || now - detection.at >= DETECTION_TTL_MS) {
    const agents = detectAgents();
    agents.catch(() => {
      if (detection?.agents === agents) detection = null;
    });
    detection = { at: now, agents };
  }
  return detection.agents;
}

const SETTINGS_FILE = "settings.json";

// Other keys are kept as they are, for settings added later.
const settingsFileSchema = z
  .object({ coding_agent: codingAgentSchema.optional() })
  .passthrough();

// A missing file is the same as no choice; a malformed one is a configuration
// error and throws.
async function readSettingsFile(): Promise<z.infer<typeof settingsFileSchema>> {
  let raw: string;
  try {
    raw = await readFile(userConfigPath(SETTINGS_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  return settingsFileSchema.parse(JSON.parse(raw));
}

export async function chosenCodingAgent(): Promise<CodingAgent | null> {
  return (await readSettingsFile()).coding_agent ?? null;
}

export async function saveChosenCodingAgent(agent: CodingAgent): Promise<void> {
  const settings = await readSettingsFile();
  const path = userConfigPath(SETTINGS_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ ...settings, coding_agent: agent }, null, 2)}\n`,
  );
}

/** Pure: the agents that are installed, in preference order. */
export function installedCodingAgents(
  detected: readonly DetectedAgent[],
): InstalledAgent[] {
  return detected.filter(
    (status): status is InstalledAgent => status.installed,
  );
}

/** Pure: the chosen agent when it is installed, else the first installed. */
export function activeCodingAgent(
  detected: readonly DetectedAgent[],
  chosen: CodingAgent | null,
): InstalledAgent | null {
  const installed = installedCodingAgents(detected);
  return installed.find((a) => a.agent === chosen) ?? installed[0] ?? null;
}

/** The agent dbu6 uses right now, or null when none is installed. */
export async function currentCodingAgent(): Promise<InstalledAgent | null> {
  const [detected, chosen] = await Promise.all([
    detectCodingAgents(),
    chosenCodingAgent(),
  ]);
  return activeCodingAgent(detected, chosen);
}

/** Logs the agent dbu6 will use, for startup. */
export function logCodingAgent(agent: InstalledAgent | null): void {
  console.log(
    agent === null
      ? "[coding-agent] no coding agent installed: categorization and agent prompts are off"
      : `[coding-agent] using ${CODING_AGENTS[agent.agent].label} (${agent.binaryPath})`,
  );
}
