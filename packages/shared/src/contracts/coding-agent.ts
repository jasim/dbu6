import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

/*
 * The coding-agent CLIs dbu6 works with on the machine running its server, in
 * preference order. dbu6 uses one of them for everything AI: categorization
 * runs on it, and prompts for the user's agent open in it. Which one is a
 * setting; until the user picks, it is the first one installed.
 *
 * What the screens say about an agent is here; how the server runs one —
 * its models and its session options — is in
 * packages/api/modules/coding-agent/.
 */

export const codingAgentSchema = z.enum(["claude-code", "codex"]);
export type CodingAgent = z.infer<typeof codingAgentSchema>;

export const CODING_AGENTS = {
  "claude-code": { label: "Claude Code", signInCommand: "claude" },
  codex: { label: "Codex", signInCommand: "codex login" },
} as const satisfies Record<
  CodingAgent,
  { label: string; signInCommand: string }
>;

/** "Claude Code or Codex": the agents dbu6 works with, named. */
export const ANY_CODING_AGENT = codingAgentSchema.options
  .map((agent) => CODING_AGENTS[agent].label)
  .join(" or ");

export const NO_CODING_AGENT_MESSAGE = `No coding agent found. Install ${ANY_CODING_AGENT} on the machine running dbu6.`;

const c = initContract();

/** One of the models dbu6 runs an agent on, by the agent's own name for it. */
export const agentModelSchema = z.object({
  model: z.string(),
  label: z.string(),
});
export type AgentModel = z.infer<typeof agentModelSchema>;

export const unavailableAgentModelSchema = agentModelSchema.extend({
  /** Why the model didn't answer, as the agent put it. */
  reason: z.string(),
});
export type UnavailableAgentModel = z.infer<typeof unavailableAgentModelSchema>;

/**
 * Which of an agent's models answer on this machine's login. dbu6 runs each
 * agent on a short list of models, most capable first, and never on a model
 * below the last (Claude Sonnet, GPT-5.6 Terra).
 */
export const agentModelsSchema = z.discriminatedUnion("state", [
  /** Not installed or not signed in, so not asked yet. */
  z.object({ state: z.literal("not_checked") }),
  z.object({ state: z.literal("checking") }),
  z.object({
    state: z.literal("ready"),
    /** The most capable model that answered; prompts open on it. */
    session: agentModelSchema,
    /** The least capable model that answered; categorization runs on it. */
    categorization: agentModelSchema,
    unavailable: z.array(unavailableAgentModelSchema),
  }),
  /** None of the models answered, so the agent can't be used. */
  z.object({
    state: z.literal("no_model"),
    unavailable: z.array(unavailableAgentModelSchema),
  }),
]);
export type AgentModels = z.infer<typeof agentModelsSchema>;

/**
 * Why an agent none of whose models answered can't be used. The server says
 * this when it refuses a prompt or a categorization; Settings says it with
 * each model's reason under it.
 */
export function noAgentModelMessage(
  agent: CodingAgent,
  unavailable: readonly UnavailableAgentModel[],
): string {
  const labels = unavailable.map((model) => model.label).join(" or ");
  return `${CODING_AGENTS[agent].label} didn't answer on ${labels}, and dbu6 doesn't use less capable models.`;
}

export const codingAgentStatusSchema = z.object({
  agent: codingAgentSchema,
  installed: z.boolean(),
  logged_in: z.boolean(),
  models: agentModelsSchema,
});
export type CodingAgentStatus = z.infer<typeof codingAgentStatusSchema>;

export const codingAgentSettingsSchema = z.object({
  /** Every agent dbu6 knows, Claude Code first, installed or not. */
  agents: z.array(codingAgentStatusSchema),
  /**
   * The agent dbu6 uses: the chosen one when it is installed, else the first
   * installed one. Null when none is installed.
   */
  active: codingAgentSchema.nullable(),
});
export type CodingAgentSettings = z.infer<typeof codingAgentSettingsSchema>;

export const chooseCodingAgentRequestSchema = z.object({
  agent: codingAgentSchema,
});

export const codingAgentErrorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
  })
  .passthrough();

export const codingAgentContract = c.router({
  getCodingAgentSettings: c.query({
    method: "GET",
    path: "/coding-agent",
    summary: "The coding agents on the server's machine, and the one dbu6 uses",
    responses: {
      200: codingAgentSettingsSchema,
      403: codingAgentErrorSchema,
    },
  }),
  chooseCodingAgent: c.mutation({
    method: "PUT",
    path: "/coding-agent",
    summary: "Choose the coding agent dbu6 uses",
    body: chooseCodingAgentRequestSchema,
    responses: {
      200: codingAgentSettingsSchema,
      400: codingAgentErrorSchema,
      403: codingAgentErrorSchema,
    },
  }),
  checkCodingAgentModels: c.mutation({
    method: "POST",
    path: "/coding-agent/model-check",
    summary:
      "Ask each of the active agent's models again whether it answers; the settings show the check running",
    body: z.object({}),
    responses: {
      200: codingAgentSettingsSchema,
      400: codingAgentErrorSchema,
      403: codingAgentErrorSchema,
    },
  }),
});
