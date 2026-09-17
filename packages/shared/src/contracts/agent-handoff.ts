import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { codingAgentSchema } from "./coding-agent.js";

/*
 * Handing a prompt to a coding agent on the machine running the server. The
 * server writes the prompt to a file under `tmp/agent-prompts/` with a small
 * launcher script beside it, which starts the agent interactively in the
 * project root with the prompt as its first message. On macOS the server can
 * open the launcher in a new terminal window; elsewhere the user runs
 * `command` in a terminal of their own.
 */

const c = initContract();

export const agentHandoffCapabilitiesSchema = z.object({
  /** The agents installed on the server's machine, Claude Code first. */
  agents: z.array(codingAgentSchema),
  /** The server can open a terminal window running the launcher (macOS). */
  open_terminal: z.boolean(),
  /** The server can write a launcher for the user to run (not on Windows). */
  shell_command: z.boolean(),
});
export type AgentHandoffCapabilities = z.infer<
  typeof agentHandoffCapabilitiesSchema
>;

export const agentHandoffRequestSchema = z.object({
  agent: codingAgentSchema,
  prompt: z.string().min(1).max(256_000),
  /** Open the launcher in a new terminal window as well as writing it. */
  open: z.boolean(),
});
export type AgentHandoffRequest = z.infer<typeof agentHandoffRequestSchema>;

export const agentHandoffSchema = z.object({
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
  getAgentHandoffCapabilities: c.query({
    method: "GET",
    path: "/agent-handoff",
    summary: "Which coding agents a prompt can be handed to on this machine",
    responses: {
      200: agentHandoffCapabilitiesSchema,
      403: agentHandoffErrorSchema,
    },
  }),
  handOffPrompt: c.mutation({
    method: "POST",
    path: "/agent-handoff",
    summary:
      "Write a prompt and a launcher that starts a coding agent on it, and optionally open it in a terminal",
    body: agentHandoffRequestSchema,
    responses: {
      200: agentHandoffSchema,
      400: agentHandoffErrorSchema,
      403: agentHandoffErrorSchema,
      500: agentHandoffErrorSchema,
    },
  }),
});
