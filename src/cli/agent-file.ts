/**
 * The one file `dbu6 agent env` writes: `.env.agent`, and the mode a credential
 * needs. The command decides what goes in it (`agent-env.ts`) and who it is for
 * (`agent.ts`); this module is the contact with the disk.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { join } from "node:path";
import { AGENT_ENV_FILE, type AgentEnvValues } from "./agent-env.js";

/** Where the file lives in a project. */
export function agentEnvPath(root: string): string {
  return join(root, AGENT_ENV_FILE);
}

/**
 * Writes the file, and makes sure it is private.
 *
 * `mode` on `writeFileSync` applies only when the file is created, so an
 * existing one — a restored backup, or one this command did not write — keeps
 * whatever mode it had. It holds a credential either way, so it is chmodded.
 */
export function writeAgentEnvFile(file: string, contents: string): void {
  writeFileSync(file, contents, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/**
 * What the project's file holds, or null when it is absent or incomplete.
 *
 * `dbu6 agent env --print` reads this: the pair to export is the one the
 * project already uses, so printing it mints nothing.
 */
export function readAgentEnvValues(file: string): AgentEnvValues | null {
  if (!existsSync(file)) return null;
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const apiUrl = parsed.SAPPORTA_API_URL;
  const apiToken = parsed.SAPPORTA_API_TOKEN;
  if (apiUrl === undefined || apiUrl === "") return null;
  if (apiToken === undefined || apiToken === "") return null;
  return { apiUrl, apiToken };
}
