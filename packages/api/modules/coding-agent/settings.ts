import type { CodingAgent, CodingAgentSettings } from "dbu6-shared";
import {
  activeCodingAgent,
  chosenCodingAgent,
  detectCodingAgents,
  installedCodingAgents,
  saveChosenCodingAgent,
} from "./agents.js";
import { CodingAgentNotInstalledError, NoCodingAgentError } from "./errors.js";
import { agentModelsNow, checkAgentModelsAgain } from "./models.js";
import type { DetectedAgent } from "./nuabase.js";

/*
 * What the Settings screen does with the machine's coding agents: read them,
 * choose one, ask their models again. Every read detects afresh, so an agent
 * installed or signed in since shows up on reload, and each agent's models are
 * its last check's (models.ts) — one still running reads as `checking`, and
 * the screen asks again until it finishes.
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
  return Promise.all([
    detectCodingAgents({ fresh: true }),
    chosenCodingAgent(),
  ]);
}

export async function codingAgentSettings(): Promise<CodingAgentSettings> {
  const [detected, chosen] = await detectedAndChosen();
  return codingAgentSettingsFrom(detected, chosen, agentModelsNow);
}

/** Saves the choice, or refuses an agent that isn't installed. */
export async function chooseCodingAgent(
  agent: CodingAgent,
): Promise<CodingAgentSettings> {
  const detected = await detectCodingAgents({ fresh: true });
  if (!installedCodingAgents(detected).some((one) => one.agent === agent)) {
    throw new CodingAgentNotInstalledError(agent);
  }
  await saveChosenCodingAgent(agent);
  return codingAgentSettingsFrom(detected, agent, agentModelsNow);
}

/**
 * Starts another check of the agent dbu6 uses, and gives the settings back
 * with that check running.
 */
export async function recheckCodingAgentModels(): Promise<CodingAgentSettings> {
  const [detected, chosen] = await detectedAndChosen();
  const active = activeCodingAgent(detected, chosen);
  if (active === null) throw new NoCodingAgentError();
  void checkAgentModelsAgain(active);
  return codingAgentSettingsFrom(detected, chosen, agentModelsNow);
}
