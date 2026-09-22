import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { codingAgentSchema } from "./coding-agent.js";

/*
 * Handing a prompt to the coding agent dbu6 uses, on the machine running the
 * server, as an interactive session the user carries on in a terminal. The
 * server decides how: on macOS it opens a terminal window running the agent on
 * the prompt; on other POSIX systems it gives a command to run in one.
 */

const c = initContract();

/**
 * terminal: the server opens a terminal window running the agent.
 * command: the user runs the handoff's `command` in a terminal of their own.
 */
export const agentHandoffModeSchema = z.enum(["terminal", "command"]);
export type AgentHandoffMode = z.infer<typeof agentHandoffModeSchema>;

/**
 * How a prompt would be handed off now, and to which agent. `none` when no
 * coding agent is installed, or on Windows, which has no launcher.
 */
export const agentHandoffAvailabilitySchema = z.union([
  z.object({ mode: z.literal("none") }),
  z.object({ mode: agentHandoffModeSchema, agent: codingAgentSchema }),
]);
export type AgentHandoffAvailability = z.infer<
  typeof agentHandoffAvailabilitySchema
>;

export const agentHandoffRequestSchema = z.object({
  prompt: z.string().min(1).max(256_000),
});
export type AgentHandoffRequest = z.infer<typeof agentHandoffRequestSchema>;

/** A handoff the server made: the agent it started, and how. */
export const agentHandoffSchema = z.object({
  agent: codingAgentSchema,
  mode: agentHandoffModeSchema,
  prompt_path: z.string(),
  launcher_path: z.string(),
  /** Runs the launcher from any terminal: `sh '<launcher_path>'`. */
  command: z.string(),
});
export type AgentHandoff = z.infer<typeof agentHandoffSchema>;

export const agentHandoffErrorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
  })
  .passthrough();
export type AgentHandoffErrorBody = z.infer<typeof agentHandoffErrorSchema>;

export const agentHandoffContract = c.router({
  getAgentHandoffAvailability: c.query({
    method: "GET",
    path: "/agent-handoff",
    summary: "Which coding agent a prompt would be handed to, and how",
    responses: {
      200: agentHandoffAvailabilitySchema,
      403: agentHandoffErrorSchema,
    },
  }),
  handOffPrompt: c.mutation({
    method: "POST",
    path: "/agent-handoff",
    summary:
      "Write a prompt and a launcher that starts the coding agent on it, and open it in a terminal where the server can",
    body: agentHandoffRequestSchema,
    responses: {
      200: agentHandoffSchema,
      400: agentHandoffErrorSchema,
      403: agentHandoffErrorSchema,
      500: agentHandoffErrorSchema,
    },
  }),
});
