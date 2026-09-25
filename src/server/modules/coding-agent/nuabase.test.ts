import { beforeEach, describe, expect, it, vi } from "vitest";

// nuabase is stubbed: these tests are about what dbu6 makes of what it says.
const { detectLocalAgents } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({
  detectLocalAgents,
  localAgent: vi.fn(),
}));
vi.mock("nuabase", () => ({ Nua: { direct: vi.fn(), gateway: vi.fn() } }));

import { Nua } from "nuabase";
import { z } from "zod";
import {
  agentGetClient,
  detectAgents,
  llmFailureMessage,
  reportedError,
} from "./nuabase.js";

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
  it("keeps what dbu6 reads of each status, in nuabase's order", async () => {
    detectLocalAgents.mockResolvedValue([
      CLAUDE,
      {
        agent: "codex",
        installed: false,
        loggedIn: false,
        detail: "not on PATH",
      },
    ]);

    expect(await detectAgents()).toEqual([
      {
        agent: "claude-code",
        installed: true,
        loggedIn: true,
        binaryPath: "/sample/bin/claude",
      },
      { agent: "codex", installed: false, loggedIn: false },
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
    ]);
  });

  it("refuses a status for an agent it knows but can't read", async () => {
    detectLocalAgents.mockResolvedValue([
      { agent: "codex", installed: true, loggedIn: true },
    ]);

    await expect(detectAgents()).rejects.toThrow();
  });
});

describe("llmFailureMessage", () => {
  it("reads the message out of the API error Codex passes on", () => {
    expect(
      llmFailureMessage(
        `codex: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.6-sol' model is not supported on this sample account."}}`,
      ),
    ).toBe("The 'gpt-5.6-sol' model is not supported on this sample account.");
  });

  it("drops Nuabase's retry prefix and the CLI's name", () => {
    expect(
      llmFailureMessage(
        "LLM call failed after 3 attempts. Last error: claude: There's an issue with the selected model (sample-050505).",
      ),
    ).toBe("There's an issue with the selected model (sample-050505).");
  });
});

describe("reportedError", () => {
  it("keeps a short message as it is, on one line", () => {
    expect(reportedError("Not logged in.\n  Run /login")).toBe(
      "Not logged in. Run /login",
    );
  });

  it("reduces an HTML error page to its title", () => {
    expect(
      reportedError(
        "<!DOCTYPE html>\n<html>\n<head>\n  <title>We're sorry, but something went wrong (500)</title>\n  <style>body {}</style></head><body>...</body></html>",
      ),
    ).toBe("We're sorry, but something went wrong (500)");
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
      "sample-model",
    );

  it("sends the input and output, and parses the value it answers", async () => {
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

  it("reports a failed call in the agent's own words", async () => {
    answering({
      success: false,
      error:
        "LLM call failed after 3 attempts. Last error: claude: sample failure",
    });
    expect(await client().get(request)).toEqual({
      ok: false,
      error: "sample failure",
    });
  });

  it("refuses a value that isn't what the schema says", async () => {
    answering({ success: true, data: { accounts: "three" } });
    const answer = await client().get(request);
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error).toMatch(/shape dbu6 doesn't know/);
  });
});
