import { describe, expect, it } from "vitest";
import { NO_CODING_AGENT_MESSAGE } from "./coding-agent.js";
import {
  gatewayLlm,
  localAgentLlm,
  parseLlmEngineSetting,
} from "./llm-engine.js";

describe("parseLlmEngineSetting", () => {
  it("uses the coding agent when LLM_ENGINE is unset or blank", () => {
    expect(parseLlmEngineSetting({ NUABASE_API_KEY: "sample-key" })).toEqual({
      ok: true,
      setting: { engine: "coding-agent" },
    });
    expect(parseLlmEngineSetting({ LLM_ENGINE: "  " })).toEqual({
      ok: true,
      setting: { engine: "coding-agent" },
    });
  });

  it("uses the Nuabase gateway only when asked, with its key", () => {
    expect(
      parseLlmEngineSetting({
        LLM_ENGINE: "nuabase",
        NUABASE_API_KEY: "sample-key",
      }),
    ).toEqual({
      ok: true,
      setting: { engine: "nuabase", apiKey: "sample-key" },
    });
    expect(
      parseLlmEngineSetting({ LLM_ENGINE: "nuabase", NUABASE_API_KEY: "" }),
    ).toEqual({ ok: true, setting: { engine: "nuabase", apiKey: null } });
  });

  it("refuses any other engine, pointing at Settings", () => {
    expect(parseLlmEngineSetting({ LLM_ENGINE: "codex" })).toEqual({
      ok: false,
      message:
        'LLM_ENGINE can only be "nuabase" (the deprecated Nuabase gateway); it is "codex". Unset it to use the coding agent chosen in Settings.',
    });
  });
});

describe("gatewayLlm", () => {
  it("calls the gateway with its provider model, all rows at once", () => {
    const llm = gatewayLlm("sample-key");

    expect(llm.engine).toBe("nuabase");
    expect(llm.maxRowsPerCall).toBeNull();
    expect(llm.caller).toMatchObject({
      ready: true,
      model: { provider: "openrouter", model: "z-ai/glm-5.2" },
    });
  });

  it("says why the gateway can't run without an API key", () => {
    expect(gatewayLlm(null).caller).toEqual({
      ready: false,
      reason: "NUABASE_API_KEY is not set",
    });
  });
});

describe("localAgentLlm", () => {
  it("runs the detected agent on its own model, 50 descriptions a call", () => {
    const llm = localAgentLlm({
      agent: "claude-code",
      installed: true,
      loggedIn: true,
      binaryPath: "/sample/bin/claude",
    });

    expect(llm.engine).toBe("claude-code");
    expect(llm.maxRowsPerCall).toBe(50);
    expect(llm.caller).toMatchObject({ ready: true, model: undefined });
  });

  it("says why nothing can run without a coding agent", () => {
    const llm = localAgentLlm(null);

    expect(llm.engine).toBeNull();
    expect(llm.caller).toEqual({
      ready: false,
      reason: NO_CODING_AGENT_MESSAGE,
    });
  });
});
