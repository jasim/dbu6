import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  codingAgentSchema,
  type AgentModel,
  type CodingAgent,
} from "../../../shared/index.js";
import { readDbuConfig, writeDbuConfig } from "../../dbu-config.js";
import { userConfigPath } from "../../paths.js";
import {
  detectAgents,
  detectedAgentSchema,
  type DetectedAgent,
  type InstalledAgent,
} from "./nuabase.js";

/*
 * Which coding agent dbu6 uses for everything AI, and how it runs each one.
 * It is always the chosen one (codingAgentInUse in src/shared): until the
 * user chooses, dbu6 picks the first installed agent that works and saves it
 * as the choice (models.ts). The choice lives in user-config/settings.json:
 * the agent belongs to this machine, not to a workspace.
 *
 * What the screens say about an agent — its name, how to sign in — is in
 * CODING_AGENTS in src/shared. Both are keyed by the same agents, so adding
 * one is an entry in each.
 */

/**
 * How dbu6 runs each agent.
 *
 * `models` are the agent's models, most capable first; the last is a floor, so
 * dbu6 never runs the agent on a less capable model. Pi's single entry has no
 * model name: dbu6 runs Pi on whichever default the user configured in Pi.
 * Which of them answer depends on the user's login and plan, which models.ts
 * checks.
 *
 * A session's other options, such as its auto mode, are nuabase's
 * (nuabase.ts).
 */
export const CODING_AGENT_RUN = {
  "claude-code": {
    models: [
      { model: "opus", label: "Claude Opus" },
      { model: "sonnet", label: "Claude Sonnet" },
    ],
  },
  codex: {
    models: [
      { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    ],
  },
  pi: {
    // Pi chooses its own model: dbu6 names none, so Pi runs the default the
    // user configured in it (settings.json), thinking level and all.
    models: [{ label: "Pi's default" }],
  },
} as const satisfies Record<
  CodingAgent,
  { models: readonly AgentModel[] }
>;

const detectedAgentsSchema = z.array(detectedAgentSchema);

let detecting: Promise<DetectedAgent[]> | null = null;

// Runs each agent's CLI, and keeps what it found in dbu_config. Callers during
// a detection share it.
function detectAndStore(): Promise<DetectedAgent[]> {
  detecting ??= detectAgents()
    .then((agents) => {
      writeDbuConfig("coding_agent.agents", agents);
      return agents;
    })
    .finally(() => {
      detecting = null;
    });
  return detecting;
}

/**
 * Every agent dbu6 knows, Claude Code first, and whether each is installed and
 * logged in. Detection runs each CLI, so it runs once, when nothing is stored
 * yet or what is stored was detected by a dbu6 that knew fewer agents, and its
 * result is kept in dbu_config across restarts: an agent installed or signed
 * in since shows up when Settings detects again (`detectCodingAgentsAgain`).
 */
export function codingAgents(): Promise<DetectedAgent[]> {
  const stored = readDbuConfig("coding_agent.agents", detectedAgentsSchema);
  return stored === null || !namesEveryAgent(stored)
    ? detectAndStore()
    : Promise.resolve(stored);
}

/**
 * Pure: whether a detection names every agent dbu6 knows. Detection names
 * each, installed or not, so one that doesn't was kept by an older dbu6.
 */
export function namesEveryAgent(detected: readonly DetectedAgent[]): boolean {
  return codingAgentSchema.options.every((agent) =>
    detected.some((status) => status.agent === agent),
  );
}

/** Detects the agents again and keeps the result, for Settings. */
export function detectCodingAgentsAgain(): Promise<DetectedAgent[]> {
  return detectAndStore();
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
