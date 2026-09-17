import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { CODING_AGENT_LABEL, codingAgentContract } from "dbu6-shared";
import {
  activeCodingAgent,
  chosenCodingAgent,
  codingAgentSettings,
  detectCodingAgents,
  NO_CODING_AGENT_MESSAGE,
  saveChosenCodingAgent,
} from "../coding-agent.js";
import {
  agentModelsNow,
  checkAgentModelsAgain,
} from "../coding-agent-models.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// The Settings screen's coding agent. Every route detects the agents afresh,
// so one installed or logged in since shows up on reload. Each agent's models
// come from its last check (coding-agent-models.ts); a check still running
// shows as `checking`, and the screen asks again until it finishes.

const api = new TsRestApi<SapportaEnv>();

api.register(
  "getCodingAgentSettings",
  codingAgentContract.getCodingAgentSettings,
  async ({ c }) => {
    requireWorkflowAuth(c);
    const [detected, chosen] = await Promise.all([
      detectCodingAgents({ fresh: true }),
      chosenCodingAgent(),
    ]);
    return {
      status: 200,
      body: codingAgentSettings(detected, chosen, agentModelsNow),
    };
  },
);

api.register(
  "chooseCodingAgent",
  codingAgentContract.chooseCodingAgent,
  async ({ c, request }) => {
    requireWorkflowAuth(c);
    const { agent } = request.body;
    const detected = await detectCodingAgents({ fresh: true });
    if (
      !detected.some((status) => status.agent === agent && status.installed)
    ) {
      return {
        status: 400,
        body: {
          error: "agent_not_installed",
          message: `${CODING_AGENT_LABEL[agent]} isn't installed on the machine running dbu6.`,
        },
      };
    }
    await saveChosenCodingAgent(agent);
    return {
      status: 200,
      body: codingAgentSettings(detected, agent, agentModelsNow),
    };
  },
);

api.register(
  "checkCodingAgentModels",
  codingAgentContract.checkCodingAgentModels,
  async ({ c }) => {
    requireWorkflowAuth(c);
    const [detected, chosen] = await Promise.all([
      detectCodingAgents({ fresh: true }),
      chosenCodingAgent(),
    ]);
    const active = activeCodingAgent(detected, chosen);
    if (active === null) {
      return {
        status: 400,
        body: { error: "no_coding_agent", message: NO_CODING_AGENT_MESSAGE },
      };
    }
    void checkAgentModelsAgain(active);
    return {
      status: 200,
      body: codingAgentSettings(detected, chosen, agentModelsNow),
    };
  },
);

export default api;
