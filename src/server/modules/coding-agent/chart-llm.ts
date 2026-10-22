import { CODING_AGENTS } from "../../../shared/index.js";
import type { ChartLlm } from "../chart-of-accounts/index.js";
import {
  currentLlmEngine,
  unavailableEngineName,
} from "./categorization-llm.js";
import { agentGetClient } from "./nuabase.js";

/*
 * Where setup's chart of accounts is drawn: on the engine
 * categorization runs on (categorization-llm.ts), but on the agent's most
 * capable model that answered, the one prompts open on. Drawing a chart is
 * a single call, where categorization's many small ones take the cheapest.
 */

/** Who draws a chart of accounts right now, or why nobody can. */
export async function chartLlm(): Promise<ChartLlm> {
  const engine = await currentLlmEngine();
  switch (engine.kind) {
    case "unavailable":
      return {
        name: unavailableEngineName(engine.agent),
        caller: { ready: false, reason: engine.reason },
      };
    case "agent": {
      const { agent } = engine;
      // At the agent's own effort: one careful answer.
      const call = { model: engine.models.session.model, effort: undefined };
      return {
        name: CODING_AGENTS[agent.agent].label,
        caller: { ready: true, client: agentGetClient(agent, call) },
      };
    }
  }
}
