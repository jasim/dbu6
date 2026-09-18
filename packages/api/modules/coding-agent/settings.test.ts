import { describe, expect, it } from "vitest";
import { codingAgentSettingsFrom } from "./settings.js";
import type { DetectedAgent } from "./nuabase.js";

const CLAUDE: DetectedAgent = {
  agent: "claude-code",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/claude",
};
const NO_CODEX: DetectedAgent = {
  agent: "codex",
  installed: false,
  loggedIn: false,
};

describe("codingAgentSettingsFrom", () => {
  it("lists every agent with its status and models, and the active one", () => {
    expect(
      codingAgentSettingsFrom([CLAUDE, NO_CODEX], null, (status) =>
        status.loggedIn
          ? {
              state: "ready",
              session: { model: "opus", label: "Claude Opus" },
              categorization: { model: "sonnet", label: "Claude Sonnet" },
              unavailable: [],
            }
          : { state: "not_checked" },
      ),
    ).toEqual({
      agents: [
        {
          agent: "claude-code",
          installed: true,
          logged_in: true,
          models: {
            state: "ready",
            session: { model: "opus", label: "Claude Opus" },
            categorization: { model: "sonnet", label: "Claude Sonnet" },
            unavailable: [],
          },
        },
        {
          agent: "codex",
          installed: false,
          logged_in: false,
          models: { state: "not_checked" },
        },
      ],
      active: "claude-code",
    });
  });
});
