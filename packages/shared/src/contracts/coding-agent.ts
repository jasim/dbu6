import { z } from "zod";

/*
 * The coding-agent CLIs dbu6 works with on the machine running its server:
 * Claude Code (`claude`) and Codex (`codex`), in preference order. Prompts for
 * the user's agent open in them, and categorization can run on them.
 */

export const codingAgentSchema = z.enum(["claude-code", "codex"]);
export type CodingAgent = z.infer<typeof codingAgentSchema>;

export const CODING_AGENT_LABEL = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const satisfies Record<CodingAgent, string>;
