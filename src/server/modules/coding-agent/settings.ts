import type {
  CodingAgent,
  CodingAgentSettings,
} from "../../../shared/index.js";
import {
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
  pickCodingAgent,
  pickingCodingAgent,
} from "./models.js";
import type { DetectedAgent } from "./nuabase.js";

/*
 * What the Settings screen does with the machine's coding agents: read them,
 * choose one, detect them and ask their models again. A read shows what was
 * detected last (agents.ts), and each agent's models are its last check's
 * (models.ts), both kept in dbu_config; only checking again runs the agents'
 * CLIs, so an agent installed or signed in since shows up then. A check still
 * running reads as `checking`, and the screen asks again until it finishes.
 * With no agent chosen, dbu6's pick of the first that works (models.ts) runs
 * at startup and when checking again, and reads as `picking` until it has
 * chosen one or found none.
 */

/** Pure: the settings for these agents, the choice and their models. */
export function codingAgentSettingsFrom(
  detected: readonly DetectedAgent[],
  chosen: CodingAgent | null,
  picking: boolean,
  models: (status: DetectedAgent) => AgentModelsView,
): CodingAgentSettings {
  return {
    agents: detected.map((status) => ({
      agent: status.agent,
      installed: status.installed,
      logged_in: status.loggedIn,
      models: models(status),
    })),
    chosen,
    picking,
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
  return settingsNow(detected, chosen);
}

function settingsNow(
  detected: readonly DetectedAgent[],
  chosen: CodingAgent | null,
): CodingAgentSettings {
  return codingAgentSettingsFrom(
    detected,
    chosen,
    chosen === null && pickingCodingAgent(),
    agentModelsNow,
  );
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
  return codingAgentSettingsFrom(detected, agent, false, agentModelsNow);
}

/**
 * Detects the agents again and forgets every model check, then starts one for
 * the chosen agent when it is signed in, or with none chosen, starts a pick;
 * the settings come back with that running, and the other signed-in agents'
 * checks start as Settings shows them.
 */
export async function recheckCodingAgentModels(): Promise<CodingAgentSettings> {
  const [detected, chosen] = await Promise.all([
    detectCodingAgentsAgain(),
    chosenCodingAgent(),
  ]);
  forgetAgentModels();
  const agent = installedCodingAgents(detected).find(
    (status) => status.agent === chosen,
  );
  if (agent?.loggedIn) void checkAgentModelsAgain(agent);
  if (chosen === null) void pickCodingAgent();
  return settingsNow(detected, chosen);
}
