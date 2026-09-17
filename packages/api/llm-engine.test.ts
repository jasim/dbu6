import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCategorizationLlm,
  parseLlmEngineSettings,
} from "./llm-engine.js";

describe("parseLlmEngineSettings", () => {
  it("uses Nuabase when LLM_ENGINE is unset or blank", () => {
    expect(parseLlmEngineSettings({ NUABASE_API_KEY: "sample-key" })).toEqual({
      ok: true,
      settings: { engine: "nuabase", apiKey: "sample-key" },
    });
    expect(parseLlmEngineSettings({ LLM_ENGINE: "  " })).toEqual({
      ok: true,
      settings: { engine: "nuabase", apiKey: null },
    });
  });

  it("reads a blank NUABASE_API_KEY as no key", () => {
    expect(
      parseLlmEngineSettings({ LLM_ENGINE: "nuabase", NUABASE_API_KEY: "" }),
    ).toEqual({ ok: true, settings: { engine: "nuabase", apiKey: null } });
  });

  it("reads the model and binary for each coding agent", () => {
    expect(
      parseLlmEngineSettings({
        LLM_ENGINE: "claude-code",
        LOCAL_AGENT_MODEL: "haiku",
        LOCAL_AGENT_BINARY: "/sample/bin/claude",
        NUABASE_API_KEY: "sample-key",
      }),
    ).toEqual({
      ok: true,
      settings: {
        engine: "claude-code",
        model: "haiku",
        binaryPath: "/sample/bin/claude",
      },
    });
    expect(parseLlmEngineSettings({ LLM_ENGINE: "codex" })).toEqual({
      ok: true,
      settings: { engine: "codex", model: undefined, binaryPath: undefined },
    });
  });

  it("leaves a blank model and binary to the agent's defaults", () => {
    expect(
      parseLlmEngineSettings({
        LLM_ENGINE: "claude-code",
        LOCAL_AGENT_MODEL: " ",
        LOCAL_AGENT_BINARY: "",
      }),
    ).toEqual({
      ok: true,
      settings: {
        engine: "claude-code",
        model: undefined,
        binaryPath: undefined,
      },
    });
  });

  it("refuses a relative LOCAL_AGENT_BINARY", () => {
    expect(
      parseLlmEngineSettings({
        LLM_ENGINE: "codex",
        LOCAL_AGENT_BINARY: "bin/codex",
      }),
    ).toEqual({
      ok: false,
      message:
        'LOCAL_AGENT_BINARY must be an absolute path; it is "bin/codex".',
    });
  });

  it("names the choices for an unknown engine", () => {
    expect(parseLlmEngineSettings({ LLM_ENGINE: "openai" })).toEqual({
      ok: false,
      message:
        'LLM_ENGINE must be one of nuabase, claude-code, codex; it is "openai".',
    });
  });
});

describe("buildCategorizationLlm", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dbu6-llm-engine-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("calls the gateway with its provider model, all rows at once", () => {
    const llm = buildCategorizationLlm({
      engine: "nuabase",
      apiKey: "sample-key",
    });

    expect(llm.engine).toBe("nuabase");
    expect(llm.maxRowsPerCall).toBeNull();
    expect(llm.caller).toMatchObject({
      ready: true,
      model: { provider: "openrouter", model: "z-ai/glm-5.2" },
    });
  });

  it("says why the gateway can't run without an API key", () => {
    expect(
      buildCategorizationLlm({ engine: "nuabase", apiKey: null }).caller,
    ).toEqual({ ready: false, reason: "NUABASE_API_KEY is not set" });
  });

  it("runs a local agent on its own model, 50 descriptions a call", () => {
    const binary = join(dir, "claude");
    writeFileSync(binary, "#!/bin/sh\n");
    chmodSync(binary, 0o700);

    const llm = buildCategorizationLlm({
      engine: "claude-code",
      model: "haiku",
      binaryPath: binary,
    });

    expect(llm.engine).toBe("claude-code");
    expect(llm.maxRowsPerCall).toBe(50);
    expect(llm.caller).toMatchObject({ ready: true, model: undefined });
  });

  it("fails clearly when the agent isn't on PATH", () => {
    vi.stubEnv("PATH", dir);

    expect(() =>
      buildCategorizationLlm({
        engine: "codex",
        model: undefined,
        binaryPath: undefined,
      }),
    ).toThrow(
      /^LLM_ENGINE is codex, but Codex can't be set up: .*not found on PATH.* set LOCAL_AGENT_BINARY/,
    );
  });

  it("fails clearly when LOCAL_AGENT_BINARY isn't an executable file", () => {
    const missing = join(dir, "missing");
    const notExecutable = join(dir, "not-executable");
    writeFileSync(notExecutable, "sample");
    chmodSync(notExecutable, 0o600);

    const build = (binaryPath: string) => () =>
      buildCategorizationLlm({
        engine: "claude-code",
        model: undefined,
        binaryPath,
      });
    expect(build(missing)).toThrow(
      `LOCAL_AGENT_BINARY (${missing}) does not exist.`,
    );
    expect(build(dir)).toThrow(`LOCAL_AGENT_BINARY (${dir}) is not a file.`);
    expect(build(notExecutable)).toThrow(
      `LOCAL_AGENT_BINARY (${notExecutable}) is not executable.`,
    );
  });
});
