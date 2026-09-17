import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// nuabase is stubbed: these tests check which client each engine sets up and
// what it names in a call.
const { direct, gateway, localAgent, list } = vi.hoisted(() => ({
  direct: vi.fn(),
  gateway: vi.fn(),
  localAgent: vi.fn((config: unknown) => config),
  list: vi.fn(async (_prompt: string, _options: Record<string, unknown>) => ({
    success: true,
    data: [] as unknown[],
  })),
}));
vi.mock("nuabase", () => ({
  Nua: {
    direct: direct.mockImplementation(() => ({ list })),
    gateway: gateway.mockImplementation(() => ({ list })),
  },
}));
vi.mock("nuabase/local-agent", () => ({
  detectLocalAgents: vi.fn(),
  localAgent,
}));

import {
  gatewayLlm,
  localAgentLlm,
  parseLlmEngineSetting,
} from "./categorization-llm.js";

const CLAUDE = {
  agent: "claude-code",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/claude",
} as const;

const request = {
  prompt: "Categorize these.",
  rows: [{ id: "txn-0", text: "Expense: NOPII SHOP" }],
  output: { name: "account", schema: z.string() },
};

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
  it("runs on no coding agent, all descriptions in one call", async () => {
    const llm = gatewayLlm("sample-key");

    expect(llm.agent).toBeNull();
    expect(llm.name).toBe("the Nuabase gateway");
    if (!llm.caller.ready) throw new Error("the gateway should be ready");
    expect(llm.caller.maxRowsPerCall).toBeNull();

    await llm.caller.client.list(request);
    expect(gateway).toHaveBeenCalledWith({ apiKey: "sample-key" });
    expect(list.mock.lastCall?.[1]).toMatchObject({
      primaryKey: "id",
      model: { provider: "openrouter", model: "z-ai/glm-5.2" },
    });
  });

  it("says why the gateway can't run without an API key", () => {
    expect(gatewayLlm(null).caller).toEqual({
      ready: false,
      reason: "NUABASE_API_KEY is not set for the Nuabase gateway.",
    });
  });
});

describe("localAgentLlm", () => {
  it("runs the agent on the model it was given, 50 descriptions a call", async () => {
    const llm = localAgentLlm(CLAUDE, "sonnet");

    expect(llm.agent).toBe("claude-code");
    expect(llm.name).toBe("Claude Code");
    if (!llm.caller.ready) throw new Error("the agent should be ready");
    expect(llm.caller.maxRowsPerCall).toBe(50);

    await llm.caller.client.list(request);
    expect(localAgent).toHaveBeenCalledWith({
      agent: "claude-code",
      model: "sonnet",
      binaryPath: "/sample/bin/claude",
      timeoutMs: 180_000,
      concurrency: 2,
    });
    // A local agent takes its own model names only, so no call names one.
    expect(list.mock.lastCall?.[1]).not.toHaveProperty("model");
  });

  it("reports a call that fails in the agent's own words", async () => {
    list.mockResolvedValueOnce({
      success: false,
      error:
        "LLM call failed after 3 attempts. Last error: claude: Not logged in.",
    } as never);
    const llm = localAgentLlm(CLAUDE, "sonnet");
    if (!llm.caller.ready) throw new Error("the agent should be ready");

    expect(await llm.caller.client.list(request)).toEqual({
      ok: false,
      error: "Not logged in.",
    });
  });
});
