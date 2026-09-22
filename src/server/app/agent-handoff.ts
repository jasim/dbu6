import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { agentHandoffContract } from "../../shared/index.js";
import {
  agentHandoffAvailability,
  handOffPrompt,
} from "../modules/coding-agent/index.js";
import { projectRoot } from "../paths.js";
import { respondWithHandoffErrors } from "./coding-agent-error-response.js";
import { requireOwner } from "./workflow-auth.js";

// Handing an agent prompt to the coding agent on this machine. Both routes
// check access and call coding-agent/handoff.ts, which decides which agent,
// which model and whether a terminal can be opened.

const api = new TsRestApi<SapportaEnv>();

api.register(
  "getAgentHandoffAvailability",
  agentHandoffContract.getAgentHandoffAvailability,
  async ({ c }) => {
    requireOwner(c);
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
    requireOwner(c);
    return respondWithHandoffErrors(() =>
      handOffPrompt(request.body.prompt, process.platform, projectRoot()),
    );
  },
);

export default api;
