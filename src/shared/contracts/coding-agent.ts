import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

/*
 * The coding-agent CLIs dbu6 works with on the machine running its server, in
 * preference order. dbu6 uses one of them for everything AI: categorization
 * runs on it, and prompts for the user's agent open in it. Which one is a
 * setting. Until one is chosen, dbu6 picks the first installed agent that
 * works and saves it as the choice; a choice, the user's or dbu6's, is never
 * changed behind the user's back.
 *
 * What the screens say about an agent is here; how the server runs one —
 * its models and its session options — is in
 * src/server/modules/coding-agent/.
 */

export const codingAgentSchema = z.enum(["claude-code", "codex", "pi"]);
export type CodingAgent = z.infer<typeof codingAgentSchema>;

export const CODING_AGENTS = {
  "claude-code": { label: "Claude Code", signInCommand: "claude" },
  codex: { label: "Codex", signInCommand: "codex login" },
  pi: { label: "Pi", signInCommand: "pi" },
} as const satisfies Record<
  CodingAgent,
  { label: string; signInCommand: string }
>;

/** "Claude Code or Codex or Pi": the agents dbu6 works with, named. */
export const ANY_CODING_AGENT = codingAgentSchema.options
  .map((agent) => CODING_AGENTS[agent].label)
  .join(" or ");

export const NO_CODING_AGENT_MESSAGE = `No coding agent found. Install ${ANY_CODING_AGENT} on the machine running dbu6.`;

/** Why dbu6 has no coding agent to use. */
export type NoCodingAgent =
  /** None is installed, so there is nothing to pick. */
  | { kind: "none_installed" }
  /** None is chosen, and no installed agent worked when dbu6 tried them. */
  | { kind: "none_works" }
  /** One is chosen, but it isn't installed now. */
  | { kind: "chosen_missing"; chosen: CodingAgent };

/** The agent dbu6 uses, or why there is none. */
export type AgentInUse<T extends { agent: CodingAgent }> =
  { agent: T & { installed: true } } | { agent: null; why: NoCodingAgent };

/**
 * Pure: the agent dbu6 uses, which is always the chosen one when it is
 * installed. Never another: an agent is used only once chosen, by the user
 * or by dbu6's pick of the first that works.
 */
export function codingAgentInUse<
  T extends { agent: CodingAgent; installed: boolean },
>(agents: readonly T[], chosen: CodingAgent | null): AgentInUse<T> {
  const installed = agents.filter(
    (status): status is T & { installed: true } => status.installed,
  );
  if (chosen === null) {
    return {
      agent: null,
      why: { kind: installed.length === 0 ? "none_installed" : "none_works" },
    };
  }
  const agent = installed.find((status) => status.agent === chosen);
  return agent === undefined
    ? { agent: null, why: { kind: "chosen_missing", chosen } }
    : { agent };
}

/** Why dbu6 has no coding agent, in the log and on screen. */
export function noCodingAgentMessage(why: NoCodingAgent): string {
  switch (why.kind) {
    case "none_installed":
      return NO_CODING_AGENT_MESSAGE;
    case "none_works":
      return "None of the installed coding agents works yet. Sign one in, then check again in Settings.";
    case "chosen_missing":
      return `${CODING_AGENTS[why.chosen].label}, chosen in Settings, isn't installed. Install it, or choose another agent in Settings.`;
  }
}

// Who answers an LLM call dbu6 makes (categorizing an import, drawing a
// chart of accounts), or why nobody can: the check the call itself makes.
export const llmStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true), name: z.string() }),
  z.object({ ready: z.literal(false), name: z.string(), reason: z.string() }),
]);
export type LlmStatus = z.infer<typeof llmStatusSchema>;

const c = initContract();

/**
 * One of the models dbu6 runs an agent on, by the agent's own name for it. An
 * absent `model` means the agent's own configured default: dbu6 runs it
 * without naming a model.
 */
export const agentModelSchema = z.object({
  model: z.string().optional(),
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
   * The agent dbu6 uses, chosen by the user or picked by dbu6 as the first
   * that worked. Null until one is.
   */
  chosen: codingAgentSchema.nullable(),
  /** dbu6 is trying the installed agents to pick one, nothing being chosen. */
  picking: z.boolean(),
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
      "Detect the coding agents again and ask the chosen agent's models whether they answer, or with none chosen, pick the first that works; the settings show the check running",
    body: z.object({}),
    responses: {
      200: codingAgentSettingsSchema,
      400: codingAgentErrorSchema,
      403: codingAgentErrorSchema,
    },
  }),
});
