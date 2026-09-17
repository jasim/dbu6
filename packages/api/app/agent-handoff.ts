import { projectRoot, TsRestApi, type SapportaEnv } from "@sapporta/server";
import { agentHandoffContract } from "dbu6-shared";
import {
  agentHandoffAvailability,
  handOffPrompt,
} from "../coding-agent/handoff.js";
import { respondWithHandoffErrors } from "./coding-agent-error-response.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Handing an agent prompt to the coding agent on this machine. Both routes
// check access and call coding-agent/handoff.ts, which decides which agent,
// which model and whether a terminal can be opened.

const api = new TsRestApi<SapportaEnv>();

api.register(
  "getAgentHandoffAvailability",
  agentHandoffContract.getAgentHandoffAvailability,
  async ({ c }) => {
    requireWorkflowAuth(c);
    return {
      status: 200,
      body: await agentHandoffAvailability(process.platform),
    };
  },
);

api.register(
  "handOffPrompt",
  agentHandoffContract.handOffPrompt,
  async ({ c, request }) => {
    requireWorkflowAuth(c);
    return respondWithHandoffErrors(() =>
      handOffPrompt(request.body.prompt, process.platform, projectRoot()),
    );
  },
);

export default api;
