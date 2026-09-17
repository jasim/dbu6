import { describe, expect, it } from "vitest";
import type { CodingAgentStatus } from "dbu6-shared";
import { describeCodingAgent } from "./describeCodingAgent";

const CLAUDE: CodingAgentStatus = {
  agent: "claude-code",
  installed: true,
  logged_in: true,
};
const CODEX: CodingAgentStatus = {
  agent: "codex",
  installed: true,
  logged_in: false,
};
const NO_CLAUDE: CodingAgentStatus = {
  agent: "claude-code",
  installed: false,
  logged_in: false,
};
const NO_CODEX: CodingAgentStatus = {
  agent: "codex",
  installed: false,
  logged_in: false,
};

describe("describeCodingAgent", () => {
  it("says what the active agent does for the user", () => {
    expect(
      describeCodingAgent({ agents: [CLAUDE, CODEX], active: "claude-code" }),
    ).toEqual({
      tone: "ok",
      text: "Connected to Claude Code. It categorizes transactions, reads new bank statements, fixes import problems, and answers questions about your data.",
    });
  });

  it("says how to sign in to an agent that isn't", () => {
    expect(
      describeCodingAgent({ agents: [CLAUDE, CODEX], active: "codex" }),
    ).toEqual({
      tone: "attention",
      text: "Codex isn't signed in. Run this in a terminal, then reload:",
      command: "codex login",
    });
  });

  it("says what won't work when no agent is installed", () => {
    expect(
      describeCodingAgent({ agents: [NO_CLAUDE, NO_CODEX], active: null }),
    ).toEqual({
      tone: "attention",
      text: "No coding agent found. Without one, dbu6 can't categorize transactions, read new bank statements, or fix import problems. Install Claude Code or Codex on this machine, then reload.",
    });
  });
});
