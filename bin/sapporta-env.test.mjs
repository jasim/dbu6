// The environment the shipped `sapporta` bin hands the CLI. Every case here is
// a way a project can be wired: the project's own file, the agent's file, a
// shell that overrides both, and a port whose URL has to be derived.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  AGENT_ENV_FILE,
  findProjectRoot,
  PROJECT_ENV_FILE,
  resolveSapportaEnvironment,
} from "./sapporta-env.mjs";

const temps = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "sapporta-env-"));
  temps.push(dir);
  return dir;
}

function project(files) {
  const root = tempDir();
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("findProjectRoot", () => {
  it("names the nearest directory with sapporta.json", () => {
    const root = project({ "sapporta.json": "{}" });
    const nested = join(root, "reports", "sample");
    mkdirSync(nested, { recursive: true });

    assert.equal(findProjectRoot(nested), root);
  });

  it("falls back to package.json, which every project also has", () => {
    const root = project({ "package.json": "{}" });

    assert.equal(findProjectRoot(join(root, "tmp")), root);
  });

  it("answers with the start when neither marker is above it", () => {
    const start = join(tempDir(), "nowhere");

    assert.equal(findProjectRoot(start), start);
  });
});

describe("resolveSapportaEnvironment", () => {
  it("derives the API URL from the port the project's .env sets", () => {
    const root = project({ [PROJECT_ENV_FILE]: "SAPPORTA_API_PORT=2345\n" });

    const { env, sources } = resolveSapportaEnvironment({
      root,
      shellEnv: {},
    });

    assert.equal(env.SAPPORTA_API_URL, "http://localhost:2345");
    assert.equal(sources.apiUrl, "port 2345");
  });

  it("takes the token from .env.agent, which the server never loads", () => {
    const root = project({
      [PROJECT_ENV_FILE]: "SAPPORTA_API_PORT=2345\n",
      [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=spat_sample_050505\n",
    });

    const { env, sources } = resolveSapportaEnvironment({
      root,
      shellEnv: {},
    });

    assert.equal(env.SAPPORTA_API_TOKEN, "spat_sample_050505");
    assert.equal(sources.apiToken, AGENT_ENV_FILE);
    assert.equal(env.SAPPORTA_API_URL, "http://localhost:2345");
  });

  it("lets .env.agent override .env for the same key", () => {
    const root = project({
      [PROJECT_ENV_FILE]: "SAPPORTA_API_URL=http://localhost:1111\n",
      [AGENT_ENV_FILE]: "SAPPORTA_API_URL=http://localhost:2222\n",
    });

    const { env } = resolveSapportaEnvironment({ root, shellEnv: {} });

    assert.equal(env.SAPPORTA_API_URL, "http://localhost:2222");
  });

  it("lets the shell win over both files", () => {
    const root = project({
      [PROJECT_ENV_FILE]: "SAPPORTA_API_PORT=2345\n",
      [AGENT_ENV_FILE]:
        "SAPPORTA_API_URL=http://localhost:2222\nSAPPORTA_API_TOKEN=from-file\n",
    });

    const { env, sources } = resolveSapportaEnvironment({
      root,
      shellEnv: {
        PATH: "/sample/bin",
        SAPPORTA_API_URL: "http://localhost:9999",
        SAPPORTA_API_TOKEN: "from-shell",
      },
    });

    assert.equal(env.SAPPORTA_API_URL, "http://localhost:9999");
    assert.equal(env.SAPPORTA_API_TOKEN, "from-shell");
    assert.equal(sources.apiUrl, "shell");
    assert.equal(sources.apiToken, "shell");
    // Everything else the shell had is still there for the CLI.
    assert.equal(env.PATH, "/sample/bin");
  });

  it("keeps the port out of a URL it cannot use, leaving the CLI its default", () => {
    const root = project({ [PROJECT_ENV_FILE]: "SAPPORTA_API_PORT=99999\n" });

    const { env, sources } = resolveSapportaEnvironment({ root, shellEnv: {} });

    assert.equal(env.SAPPORTA_API_URL, undefined);
    assert.equal(sources.apiUrl, undefined);
  });

  it("reads nothing from a project that has no environment file", () => {
    const { env, sources } = resolveSapportaEnvironment({
      root: tempDir(),
      shellEnv: { HOME: "/sample/home" },
    });

    assert.equal(env.SAPPORTA_API_URL, undefined);
    assert.equal(sources.apiToken, undefined);
    assert.equal(env.HOME, "/sample/home");
  });

  it("ignores a key a file leaves empty, so a blank never blanks the value", () => {
    const root = project({
      [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=\n",
    });

    const { env, sources } = resolveSapportaEnvironment({
      root,
      shellEnv: { SAPPORTA_API_TOKEN: "from-shell" },
    });

    assert.equal(env.SAPPORTA_API_TOKEN, "from-shell");
    assert.equal(sources.apiToken, "shell");
  });
});
