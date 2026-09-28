// What the `sapporta` CLI needs in its environment to reach a running dbu6,
// resolved from the project folder rather than demanded of the person.
//
// dbu6 ships the CLI (its own `sapporta` bin forwards to `@sapporta/server`'s),
// so an agent in a project folder runs `npx sapporta …` with nothing to
// install. The CLI itself reads a token only from the environment, and finds a
// project's API port only in `.env.development` — Sapporta's own scaffold file,
// which dbu6 does not write. dbu6 keeps both in `.env`, so the wrapper that
// forwards to the CLI resolves this first and the CLI sees what the project
// already says.
//
// This file is plain JavaScript with no imports but Node's own, because
// `bin/sapporta.mjs` loads it before anything else: a project with an
// uncompiled dbu6 beside it must still get its environment. Its types are in
// `sapporta-env.d.mts`. Its tests are `sapporta-env.test.mjs`, run by
// `pnpm run test:scripts`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

/**
 * The project's own environment file, as `dbu6 dev` reads it.
 *
 * Two files are read, in precedence order, so the token stays out of `.env`:
 * that file is loaded into the server's own process, and it is one careless
 * commit away from being tracked.
 *
 *   .env         SAPPORTA_API_PORT, and anything else the project sets
 *   .env.agent   SAPPORTA_API_URL and SAPPORTA_API_TOKEN, written by
 *                `dbu6 agent env` and gitignored like `.env`
 *
 * A value already exported in the shell wins over both, the same rule
 * `dbu6 dev` follows, so mise, direnv or a deployment overrides the files
 * without editing them.
 */
export const PROJECT_ENV_FILE = ".env";

/** The agent's file: the token, kept apart from the server's environment. */
export const AGENT_ENV_FILE = ".env.agent";

/** In this order: later files override earlier ones. */
export const SAPPORTA_ENV_FILES = [PROJECT_ENV_FILE, AGENT_ENV_FILE];

const MAX_MARKER_WALK = 100;

/**
 * The project root: the nearest directory at or above `start` holding
 * `sapporta.json`, else the one holding `package.json`, else `start`.
 *
 * `sapporta.json` is Sapporta's marker and dbu6 writes it into every project;
 * the `package.json` step is what makes a project created before that marker,
 * or a dbu6 checkout used as one, still resolve.
 */
export function findProjectRoot(start, fileExists = existsSync) {
  return (
    findUp(start, "sapporta.json", fileExists) ??
    findUp(start, "package.json", fileExists) ??
    start
  );
}

function findUp(start, marker, fileExists) {
  let dir = start;
  for (let i = 0; i < MAX_MARKER_WALK; i++) {
    if (fileExists(join(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Everything the `sapporta` CLI should see: the shell's own environment, then
 * the project's files over it, then `SAPPORTA_API_URL` derived from
 * `SAPPORTA_API_PORT` when neither names the URL — the port is the one thing a
 * project must set, and during development the URL is always localhost.
 *
 * `sources` says where each value came from, so a person can see why the CLI is
 * talking to the wrong place.
 */
export function resolveSapportaEnvironment({
  root,
  shellEnv,
  fileNames = SAPPORTA_ENV_FILES,
  fileExists = existsSync,
  readFile = (path) => readFileSync(path, "utf8"),
}) {
  const fromFiles = {};
  for (const name of fileNames) {
    const path = join(root, name);
    if (!fileExists(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFile(path)))) {
      if (value === "") continue;
      fromFiles[key] = { value, file: name };
    }
  }

  const env = { ...shellEnv };
  for (const [key, { value }] of Object.entries(fromFiles)) {
    // The shell wins: it is the deliberate, per-invocation choice.
    if (readString(shellEnv[key]) !== undefined) continue;
    env[key] = value;
  }

  const sources = {
    apiUrl: sourceOf("SAPPORTA_API_URL", shellEnv, fromFiles),
    apiToken: sourceOf("SAPPORTA_API_TOKEN", shellEnv, fromFiles),
  };
  if (
    readString(env.SAPPORTA_API_URL) === undefined &&
    fromFiles.SAPPORTA_API_URL === undefined
  ) {
    const port = readString(env.SAPPORTA_API_PORT);
    if (port !== undefined && isPort(port)) {
      env.SAPPORTA_API_URL = `http://localhost:${port}`;
      sources.apiUrl = `port ${port}`;
    }
  }
  return { env, sources };
}

function sourceOf(key, shellEnv, fromFiles) {
  if (readString(shellEnv[key]) !== undefined) return "shell";
  return fromFiles[key]?.file;
}

function readString(value) {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** Sapporta's own bound on a usable port, applied to the project's value. */
function isPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
