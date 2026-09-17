import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { CODING_AGENT_LABEL, codingAgentContract } from "dbu6-shared";
import {
  chosenCodingAgent,
  codingAgentSettings,
  detectCodingAgents,
  saveChosenCodingAgent,
} from "../coding-agent.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// The Settings screen's coding agent. Both routes detect the agents afresh, so
// one installed or logged in since shows up on reload.

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
    return { status: 200, body: codingAgentSettings(detected, chosen) };
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
    return { status: 200, body: codingAgentSettings(detected, agent) };
  },
);

export default api;
