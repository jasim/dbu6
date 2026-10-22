import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// nuabase is stubbed: these tests check which client the engine sets up and
// what it names in a call.
const { direct, localAgent, list } = vi.hoisted(() => ({
  direct: vi.fn(),
  localAgent: vi.fn((config: object) => ({
    // A call's client is the agent with that call's options.
    with: (options: object) => ({ ...config, ...options }),
  })),
  list: vi.fn(async (_prompt: string, _options: Record<string, unknown>) => ({
    success: true,
    data: [] as unknown[],
  })),
}));
vi.mock("nuabase", () => ({
  Nua: { direct: direct.mockImplementation(() => ({ list })) },
}));
vi.mock("nuabase/local-agent", () => ({
  detectLocalAgents: vi.fn(),
  localAgent,
}));

import { localAgentLlm } from "./categorization-llm.js";

const CLAUDE = {
  agent: "claude-code",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/claude",
} as const;

const request = {
  prompt: "Categorize these.",
  rows: [{ id: "txn-0", text: "Expense: NOPII SHOP" }],
  output: { name: "account" as const, schema: z.string() },
};

describe("localAgentLlm", () => {
  it("runs the agent on the model it was given, at its categorization effort, 50 descriptions a call", async () => {
    const llm = localAgentLlm(CLAUDE, "sonnet");

    expect(llm.agent).toBe("claude-code");
    expect(llm.name).toBe("Claude Code");
    if (!llm.caller.ready) throw new Error("the agent should be ready");
    expect(llm.caller.maxRowsPerCall).toBe(50);

    await llm.caller.client.list(request);
    expect(direct).toHaveBeenLastCalledWith({
      localAgent: {
        agent: "claude-code",
        binaryPath: "/sample/bin/claude",
        timeoutMs: 180_000,
        logger: expect.anything(),
        concurrency: 2,
        model: "sonnet",
        effort: undefined,
      },
    });
    // The client is set up with the model, so no call names one.
    expect(list.mock.lastCall?.[1]).not.toHaveProperty("model");
  });

  it("holds Codex to low effort", async () => {
    const llm = localAgentLlm(
      { ...CLAUDE, agent: "codex", binaryPath: "/sample/bin/codex" },
      "gpt-5.6-terra",
    );
    if (!llm.caller.ready) throw new Error("the agent should be ready");

    await llm.caller.client.list(request);
    expect(direct.mock.lastCall?.[0].localAgent).toMatchObject({
      model: "gpt-5.6-terra",
      effort: "low",
    });
  });

  it("reports a call that fails in the agent's own words", async () => {
    list.mockResolvedValueOnce({
      success: false,
      error: "LLM call failed after 3 attempts. Last error: Not logged in.",
      reason: "Not logged in.",
      attempts: 3,
    } as never);
    const llm = localAgentLlm(CLAUDE, "sonnet");
    if (!llm.caller.ready) throw new Error("the agent should be ready");

    expect(await llm.caller.client.list(request)).toEqual({
      ok: false,
      error: "Not logged in.",
    });
  });
});
