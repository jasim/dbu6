import type {
  CodingAgent,
  CodingAgentSettings,
} from "../../../shared/index.js";
import {
  activeCodingAgent,
  chosenCodingAgent,
  codingAgents,
  detectCodingAgentsAgain,
  installedCodingAgents,
  saveChosenCodingAgent,
} from "./agents.js";
import { CodingAgentNotInstalledError } from "./errors.js";
import {
  agentModelsNow,
  checkAgentModelsAgain,
  forgetAgentModels,
} from "./models.js";
import type { DetectedAgent } from "./nuabase.js";

/*
 * What the Settings screen does with the machine's coding agents: read them,
 * choose one, detect them and ask their models again. A read shows what was
 * detected last (agents.ts), and each agent's models are its last check's
 * (models.ts), both kept in dbu_config; only checking again runs the agents'
 * CLIs, so an agent installed or signed in since shows up then. A check still
 * running reads as `checking`, and the screen asks again until it finishes.
 */

/** Pure: the settings for these agents, the choice and their models. */
export function codingAgentSettingsFrom(
  detected: readonly DetectedAgent[],
  chosen: CodingAgent | null,
  models: (status: DetectedAgent) => AgentModelsView,
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

type AgentModelsView = CodingAgentSettings["agents"][number]["models"];

async function detectedAndChosen(): Promise<
  [DetectedAgent[], CodingAgent | null]
> {
  return Promise.all([codingAgents(), chosenCodingAgent()]);
}

export async function codingAgentSettings(): Promise<CodingAgentSettings> {
  const [detected, chosen] = await detectedAndChosen();
  return codingAgentSettingsFrom(detected, chosen, agentModelsNow);
}

/** Saves the choice, or refuses an agent that isn't installed. */
export async function chooseCodingAgent(
  agent: CodingAgent,
): Promise<CodingAgentSettings> {
  const detected = await codingAgents();
  if (!installedCodingAgents(detected).some((one) => one.agent === agent)) {
    throw new CodingAgentNotInstalledError(agent);
  }
  await saveChosenCodingAgent(agent);
  return codingAgentSettingsFrom(detected, agent, agentModelsNow);
}

/**
 * Detects the agents again and forgets every model check, then starts one for
 * the agent dbu6 uses when it is signed in; the settings come back with that
 * check running, and the other signed-in agents' start as Settings shows them.
 */
export async function recheckCodingAgentModels(): Promise<CodingAgentSettings> {
  const [detected, chosen] = await Promise.all([
    detectCodingAgentsAgain(),
    chosenCodingAgent(),
  ]);
  forgetAgentModels();
  const active = activeCodingAgent(detected, chosen);
  if (active?.loggedIn) void checkAgentModelsAgain(active);
  return codingAgentSettingsFrom(detected, chosen, agentModelsNow);
}
