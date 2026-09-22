import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { codingAgentContract } from "../../shared/index.js";
import {
  chooseCodingAgent,
  codingAgentSettings,
  recheckCodingAgentModels,
} from "../modules/coding-agent/index.js";
import { respondWithCodingAgentErrors } from "./coding-agent-error-response.js";
import { requireOwner } from "./workflow-auth.js";

// The Settings screen's coding agent. Each route checks access, makes one call
// into coding-agent/settings.ts, and returns what it gives back; which agents
// there are, which one dbu6 uses and what its models can do are decided there.

const api = new TsRestApi<SapportaEnv>();

api.register(
  "getCodingAgentSettings",
  codingAgentContract.getCodingAgentSettings,
  async ({ c }) => {
    requireOwner(c);
    return { status: 200, body: await codingAgentSettings() };
  },
);

api.register(
  "chooseCodingAgent",
  codingAgentContract.chooseCodingAgent,
  async ({ c, request }) => {
    requireOwner(c);
    return respondWithCodingAgentErrors(() =>
      chooseCodingAgent(request.body.agent),
    );
  },
);

api.register(
  "checkCodingAgentModels",
  codingAgentContract.checkCodingAgentModels,
  async ({ c }) => {
    requireOwner(c);
    return respondWithCodingAgentErrors(recheckCodingAgentModels);
  },
);

export default api;
