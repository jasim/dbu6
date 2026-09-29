// The environment the shipped `sapporta` bin hands the CLI: the shell's own,
// plus the agent's token from `.env.agent`, and nothing else from any file.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  AGENT_ENV_FILE,
  findProjectRoot,
  sapportaEnvironment,
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

describe("sapportaEnvironment", () => {
  it("adds the token from .env.agent to the shell's environment", () => {
    const root = project({
      [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=spat_sample_050505\n",
    });

    const env = sapportaEnvironment({
      root,
      shellEnv: { PATH: "/sample/bin" },
    });

    assert.deepEqual(env, {
      PATH: "/sample/bin",
      SAPPORTA_API_TOKEN: "spat_sample_050505",
    });
  });

  it("ignores the URL an older .env.agent holds, so the CLI finds the port itself", () => {
    const root = project({
      [AGENT_ENV_FILE]:
        "SAPPORTA_API_URL=http://localhost:1111\nSAPPORTA_API_TOKEN=spat_sample_050505\n",
    });

    const env = sapportaEnvironment({ root, shellEnv: {} });

    assert.equal(env.SAPPORTA_API_URL, undefined);
    assert.equal(env.SAPPORTA_API_TOKEN, "spat_sample_050505");
  });

  it("reads no other file, the settings file included", () => {
    const root = project({
      ".env.development": "SAPPORTA_API_PORT=2345\nSAPPORTA_API_TOKEN=nope\n",
      ".env": "SAPPORTA_API_URL=http://localhost:1111\n",
    });

    assert.deepEqual(sapportaEnvironment({ root, shellEnv: {} }), {});
  });

  it("lets a token in the environment win over the file", () => {
    const root = project({
      [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=from-file\n",
    });

    const env = sapportaEnvironment({
      root,
      shellEnv: { SAPPORTA_API_TOKEN: "from-shell" },
    });

    assert.equal(env.SAPPORTA_API_TOKEN, "from-shell");
  });

  it("passes the environment's URL and port through untouched", () => {
    const root = project({
      [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=spat_sample_050505\n",
    });
    const shellEnv = {
      SAPPORTA_API_URL: "http://localhost:9999",
      SAPPORTA_API_PORT: "4000",
    };

    const env = sapportaEnvironment({ root, shellEnv });

    assert.equal(env.SAPPORTA_API_URL, "http://localhost:9999");
    assert.equal(env.SAPPORTA_API_PORT, "4000");
    // The shell's own object is not changed.
    assert.equal(shellEnv.SAPPORTA_API_TOKEN, undefined);
  });

  it("takes the file's token over an empty one in the environment", () => {
    const root = project({
      [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=from-file\n",
    });

    const env = sapportaEnvironment({
      root,
      shellEnv: { SAPPORTA_API_TOKEN: "" },
    });

    assert.equal(env.SAPPORTA_API_TOKEN, "from-file");
  });

  it("adds nothing when there is no .env.agent, or it holds no token", () => {
    assert.deepEqual(
      sapportaEnvironment({ root: tempDir(), shellEnv: { HOME: "/sample" } }),
      { HOME: "/sample" },
    );
    const blank = project({ [AGENT_ENV_FILE]: "SAPPORTA_API_TOKEN=\n" });
    assert.deepEqual(sapportaEnvironment({ root: blank, shellEnv: {} }), {});
  });
});
