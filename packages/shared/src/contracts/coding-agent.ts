import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

/*
 * The coding-agent CLIs dbu6 works with on the machine running its server:
 * Claude Code (`claude`) and Codex (`codex`), in preference order. dbu6 uses
 * one of them for everything AI: categorization runs on it, and prompts for
 * the user's agent open in it. Which one is a setting; until the user picks,
 * it is the first one installed.
 */

export const codingAgentSchema = z.enum(["claude-code", "codex"]);
export type CodingAgent = z.infer<typeof codingAgentSchema>;

export const CODING_AGENT_LABEL = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const satisfies Record<CodingAgent, string>;

const c = initContract();

export const codingAgentStatusSchema = z.object({
  agent: codingAgentSchema,
  installed: z.boolean(),
  logged_in: z.boolean(),
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
});
