/*
 * The shell script that starts a coding agent interactively on a prompt the
 * server saved to a file.
 *
 * Neither agent CLI reads its first message from a file, and a prompt can't go
 * on a command line as written: it is multi-line and holds quotes, backticks,
 * backslashes and a literal `$SAPPORTA_API_TOKEN` the agent must see
 * unexpanded. Inside `"$(cat file)"` the shell passes the file's contents as
 * one argument without expanding anything in them. `--` before it ends the
 * CLI's options, so a prompt starting with `-` can't set flags.
 *
 * The script holds only paths the server generated, never prompt text, so a
 * prompt can't inject commands. It runs from the project root so the agent
 * loads AGENTS.md / CLAUDE.md, and runs the binary at the absolute path the
 * server detected, whatever the terminal's PATH.
 */

import type { CodingAgent } from "dbu6-shared";

// Prompts open in the agent's auto mode: its own reviewer approves edits and
// commands and stops risky ones, so the user answers questions but isn't
// asked for every step. Codex's auto review keeps it in the workspace-write
// sandbox.
const AUTO_MODE = {
  "claude-code": ["--permission-mode", "auto"],
  codex: ["--approve-for-me"],
} as const satisfies Record<CodingAgent, readonly string[]>;

export type LauncherTarget = {
  projectRoot: string;
  agent: CodingAgent;
  binaryPath: string;
  /** The agent's own name for the model (coding-agent-models.ts). */
  model: string;
  promptPath: string;
};

export function launcherScript({
  projectRoot,
  agent,
  binaryPath,
  model,
  promptPath,
}: LauncherTarget): string {
  const command = [binaryPath, "--model", model, ...AUTO_MODE[agent]];
  return [
    "#!/bin/sh",
    `cd ${shellQuote(projectRoot)} || exit 1`,
    `exec ${command.map(shellQuote).join(" ")} -- "$(cat ${shellQuote(promptPath)})"`,
    "",
  ].join("\n");
}

/** The command that runs a launcher from any POSIX terminal. */
export function launcherCommand(launcherPath: string): string {
  return `sh ${shellQuote(launcherPath)}`;
}

/** One single-quoted shell word, with each `'` written as `'\''`. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
