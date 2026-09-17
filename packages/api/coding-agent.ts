import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  CODING_AGENT_LABEL,
  codingAgentSchema,
  type AgentModels,
  type CodingAgent,
  type CodingAgentSettings,
} from "dbu6-shared";
import { detectLocalAgents } from "nuabase/local-agent";
import { userConfigPath } from "./user-data.js";

/*
 * The coding agent dbu6 uses for everything AI: categorization runs on it, and
 * prompts for the user's agent open in it. It is the agent chosen in Settings
 * when that one is installed, else the first installed one, Claude Code
 * first. The choice lives in data/user-config/settings.json: the agent belongs
 * to this machine, not to a workspace.
 */

// What this module reads of nuabase's LocalAgentStatus. Its published
// declarations don't resolve under NodeNext, so the import is untyped.
export type DetectedAgent =
  | { agent: CodingAgent; installed: false; loggedIn: false }
  | {
      agent: CodingAgent;
      installed: true;
      loggedIn: boolean;
      binaryPath: string;
    };
export type InstalledAgent = Extract<DetectedAgent, { installed: true }>;

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
    const agents: Promise<DetectedAgent[]> = detectLocalAgents();
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

export const NO_CODING_AGENT_MESSAGE =
  "No coding agent found. Install Claude Code or Codex on the machine running dbu6.";

/** Pure: the chosen agent when it is installed, else the first installed. */
export function activeCodingAgent(
  detected: readonly DetectedAgent[],
  chosen: CodingAgent | null,
): InstalledAgent | null {
  const installed = detected.filter(
    (status): status is InstalledAgent => status.installed,
  );
  return installed.find((a) => a.agent === chosen) ?? installed[0] ?? null;
}

/** What the Settings screen shows, with each agent's models as `models` has them. */
export function codingAgentSettings(
  detected: readonly DetectedAgent[],
  chosen: CodingAgent | null,
  models: (status: DetectedAgent) => AgentModels,
): CodingAgentSettings {
  return {
    agents: detected.map((status) => ({
      agent: status.agent,
      installed: status.installed,
      logged_in: status.loggedIn,
      models: models(status),
    })),
    active: activeCodingAgent(detected, chosen)?.agent ?? null,
  };
}

/** The agent dbu6 uses right now, or null when none is installed. */
export async function currentCodingAgent(): Promise<InstalledAgent | null> {
  const [detected, chosen] = await Promise.all([
    detectCodingAgents(),
    chosenCodingAgent(),
  ]);
  return activeCodingAgent(detected, chosen);
}

/** Detects the agents at startup and logs the one dbu6 will use. */
export async function logCodingAgent(): Promise<void> {
  const agent = await currentCodingAgent();
  console.log(
    agent === null
      ? "[coding-agent] no coding agent installed: categorization and agent prompts are off"
      : `[coding-agent] using ${CODING_AGENT_LABEL[agent.agent]} (${agent.binaryPath})`,
  );
}
