/*
 * The shell script that starts a coding agent interactively on a prompt the
 * server saved to a file. Which options the agent takes is handoff.ts's and
 * agents.ts's business; this module only writes them safely.
 *
 * Neither agent CLI reads its first message from a file, and a prompt can't go
 * on a command line as written: it is multi-line and holds quotes, backticks,
 * backslashes and a literal `$SAPPORTA_API_TOKEN` the agent must see
 * unexpanded. Inside `"$(cat file)"` the shell passes the file's contents as
 * one argument without expanding anything in them. `--` before it ends the
 * CLI's options, so a prompt starting with `-` can't set flags.
 *
 * The script holds only paths and options the server generated, never prompt
 * text, so a prompt can't inject commands. It runs from the project root so
 * the agent loads AGENTS.md / CLAUDE.md, and runs the binary at the absolute
 * path the server detected, whatever the terminal's PATH.
 */

export type LauncherTarget = {
  projectRoot: string;
  binaryPath: string;
  /** The agent's own options, which go before the prompt. */
  agentArgs: readonly string[];
  promptPath: string;
};

export function launcherScript({
  projectRoot,
  binaryPath,
  agentArgs,
  promptPath,
}: LauncherTarget): string {
  const command = [binaryPath, ...agentArgs].map(shellQuote).join(" ");
  return [
    "#!/bin/sh",
    `cd ${shellQuote(projectRoot)} || exit 1`,
    `exec ${command} -- "$(cat ${shellQuote(promptPath)})"`,
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
