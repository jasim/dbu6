import { CODING_AGENTS } from "../../../shared/index.js";
import type { ChartLlm } from "../chart-of-accounts/index.js";
import {
  currentLlmEngine,
  GATEWAY_MODEL,
  GATEWAY_NAME,
  unavailableEngineName,
} from "./categorization-llm.js";
import { agentGetClient, gatewayGetClient } from "./nuabase.js";

/*
 * Where setup's chart of accounts is drawn: on the engine
 * categorization runs on (categorization-llm.ts), but on the agent's most
 * capable model that answered, the one prompts open on. Drawing a chart is
 * a single call, where categorization's many small ones take the cheapest.
 */

// One client per agent executable and model, so the limit on processes
// running at once (nuabase.ts) holds across requests.
const clients = new Map<string, ChartLlm>();

/** Who draws a chart of accounts right now, or why nobody can. */
export async function chartLlm(): Promise<ChartLlm> {
  const engine = await currentLlmEngine();
  switch (engine.kind) {
    case "gateway":
      return {
        name: GATEWAY_NAME,
        caller:
          engine.apiKey === null
            ? {
                ready: false,
                reason: "NUABASE_API_KEY is not set for the Nuabase gateway.",
              }
            : {
                ready: true,
                client: gatewayGetClient(engine.apiKey, GATEWAY_MODEL),
              },
      };
    case "unavailable":
      return {
        name: unavailableEngineName(engine.agent),
        caller: { ready: false, reason: engine.reason },
      };
    case "agent": {
      const { agent } = engine;
      const { model } = engine.models.session;
      const key = `${agent.agent}:${agent.binaryPath}:${model}`;
      let llm = clients.get(key);
      if (llm === undefined) {
        llm = {
          name: CODING_AGENTS[agent.agent].label,
          caller: { ready: true, client: agentGetClient(agent, model) },
        };
        clients.set(key, llm);
      }
      return llm;
    }
  }
}
