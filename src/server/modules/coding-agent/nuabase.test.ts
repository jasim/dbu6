import { beforeEach, describe, expect, it, vi } from "vitest";

// nuabase is stubbed: these tests are about what dbu6 makes of what it says.
const { detectLocalAgents } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({
  detectLocalAgents,
  localAgent: vi.fn(() => ({ with: vi.fn() })),
}));
vi.mock("nuabase", () => ({ Nua: { direct: vi.fn() } }));

import { Nua } from "nuabase";
import { z } from "zod";
import { agentGetClient, detectAgents, reportedError } from "./nuabase.js";

// As nuabase reports it, with the fields dbu6 doesn't read.
const CLAUDE = {
  agent: "claude-code",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/claude",
  version: "0.50.5",
};

beforeEach(() => {
  detectLocalAgents.mockReset();
});

describe("detectAgents", () => {
  it("keeps what dbu6 reads of each status, in dbu6's order", async () => {
    detectLocalAgents.mockResolvedValue([
      {
        agent: "codex",
        installed: false,
        loggedIn: false,
        detail: "not on PATH",
      },
      CLAUDE,
    ]);

    expect((await detectAgents()).slice(0, 2)).toEqual([
      {
        agent: "claude-code",
        installed: true,
        loggedIn: true,
        binaryPath: "/sample/bin/claude",
      },
      { agent: "codex", installed: false, loggedIn: false },
    ]);
  });

  it("names every agent dbu6 knows, one nuabase didn't report as not installed", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE]);

    expect(await detectAgents()).toEqual([
      {
        agent: "claude-code",
        installed: true,
        loggedIn: true,
        binaryPath: "/sample/bin/claude",
      },
      { agent: "codex", installed: false, loggedIn: false },
      { agent: "pi", installed: false, loggedIn: false },
    ]);
  });

  it("leaves out an agent dbu6 doesn't know", async () => {
    detectLocalAgents.mockResolvedValue([
      {
        agent: "sample-agent-050505",
        installed: true,
        loggedIn: true,
        binaryPath: "/sample/bin/other",
      },
      CLAUDE,
    ]);

    expect((await detectAgents()).map((status) => status.agent)).toEqual([
      "claude-code",
      "codex",
      "pi",
    ]);
  });
});

describe("reportedError", () => {
  it("keeps a short message as it is, on one line", () => {
    expect(reportedError("Not logged in.\n  Run /login")).toBe(
      "Not logged in. Run /login",
    );
  });

  it("cuts a long message to 300 characters", () => {
    const reported = reportedError("x".repeat(1000));
    expect(reported).toHaveLength(300);
    expect(reported.endsWith("…")).toBe(true);
  });
});

describe("agentGetClient", () => {
  const request = {
    prompt: "Draw a chart.",
    input: { description: "NOPII sample" },
    output: { name: "chart", schema: z.object({ accounts: z.number() }) },
  };
  const answering = (answer: unknown) => {
    const get = vi.fn(async () => answer);
    vi.mocked(Nua.direct).mockReturnValue({ get } as never);
    return get;
  };
  const client = () =>
    agentGetClient(
      { ...CLAUDE, agent: "claude-code", installed: true },
      { model: "sample-model", effort: undefined },
    );

  it("sends the input and output, and answers with the value", async () => {
    const get = answering({ success: true, data: { accounts: 3 } });
    expect(await client().get(request)).toEqual({
      ok: true,
      value: { accounts: 3 },
    });
    expect(get).toHaveBeenCalledWith("Draw a chart.", {
      input: request.input,
      output: request.output,
    });
  });

  it("reports a failed call in the agent's own words, logging nuabase's account", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    answering({
      success: false,
      error: "LLM call failed after 3 attempts. Last error: sample failure",
      reason: "sample failure",
      attempts: 3,
    });
    expect(await client().get(request)).toEqual({
      ok: false,
      error: "sample failure",
    });
    expect(log).toHaveBeenCalledWith(
      "[nuabase] get call failed:",
      "LLM call failed after 3 attempts. Last error: sample failure",
    );
  });
});
