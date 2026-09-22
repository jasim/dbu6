import { describe, expect, it } from "vitest";
import type { AgentModels, CodingAgentStatus } from "../../../shared/index";
import { checkingModels, describeCodingAgent } from "./describeCodingAgent";

const OPUS = { model: "opus", label: "Claude Opus" };
const SONNET = { model: "sonnet", label: "Claude Sonnet" };
const SOL = { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" };
const TERRA = { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" };

function claude(models: AgentModels): CodingAgentStatus {
  return { agent: "claude-code", installed: true, logged_in: true, models };
}
function codex(models: AgentModels): CodingAgentStatus {
  return { agent: "codex", installed: true, logged_in: true, models };
}

const CLAUDE = claude({
  state: "ready",
  session: OPUS,
  categorization: SONNET,
  unavailable: [],
});
const SIGNED_OUT_CODEX: CodingAgentStatus = {
  agent: "codex",
  installed: true,
  logged_in: false,
  models: { state: "not_checked" },
};
const NO_CLAUDE: CodingAgentStatus = {
  agent: "claude-code",
  installed: false,
  logged_in: false,
  models: { state: "not_checked" },
};
const NO_CODEX: CodingAgentStatus = {
  agent: "codex",
  installed: false,
  logged_in: false,
  models: { state: "not_checked" },
};

describe("describeCodingAgent", () => {
  it("says what the active agent does, and on which models", () => {
    expect(
      describeCodingAgent({
        agents: [CLAUDE, SIGNED_OUT_CODEX],
        active: "claude-code",
      }),
    ).toEqual({
      tone: "ok",
      text: "Connected to Claude Code. It categorizes transactions, reads new bank statements, fixes import problems, and answers questions about your data.",
      details: [
        "Claude Code sessions run on Claude Opus, and categorization on Claude Sonnet.",
      ],
      checkAgain: true,
    });
  });

  it("names a model that didn't answer, and the one used instead", () => {
    const state = describeCodingAgent({
      agents: [
        NO_CLAUDE,
        codex({
          state: "ready",
          session: TERRA,
          categorization: TERRA,
          unavailable: [{ ...SOL, reason: "Not on this sample plan." }],
        }),
      ],
      active: "codex",
    });

    expect(state.tone).toBe("ok");
    expect(state.details).toEqual([
      "Codex sessions and categorization run on GPT-5.6 Terra.",
      "GPT-5.6 Sol isn't available: Not on this sample plan.",
    ]);
  });

  it("says the models are being checked", () => {
    expect(
      describeCodingAgent({
        agents: [claude({ state: "checking" }), NO_CODEX],
        active: "claude-code",
      }),
    ).toEqual({
      tone: "ok",
      text: "Connected to Claude Code. Checking which models it can use…",
      details: [],
      checkAgain: false,
    });
  });

  it("says what won't work when none of the agent's models answered", () => {
    expect(
      describeCodingAgent({
        agents: [
          NO_CLAUDE,
          codex({
            state: "no_model",
            unavailable: [
              { ...SOL, reason: "Not on this sample plan." },
              { ...TERRA, reason: "Usage limit reached." },
            ],
          }),
        ],
        active: "codex",
      }),
    ).toEqual({
      tone: "attention",
      text: "Codex didn't answer on GPT-5.6 Sol or GPT-5.6 Terra, and dbu6 doesn't use less capable models. Until one answers, dbu6 can't categorize transactions, read new bank statements, or fix import problems.",
      details: [
        "GPT-5.6 Sol: Not on this sample plan.",
        "GPT-5.6 Terra: Usage limit reached.",
      ],
      checkAgain: true,
    });
  });

  it("says how to sign in to an agent that isn't", () => {
    expect(
      describeCodingAgent({
        agents: [CLAUDE, SIGNED_OUT_CODEX],
        active: "codex",
      }),
    ).toEqual({
      tone: "attention",
      text: "Codex isn't signed in. Run this in a terminal, then check again:",
      command: "codex login",
      details: [],
      checkAgain: true,
    });
  });

  it("says what won't work when no agent is installed", () => {
    expect(
      describeCodingAgent({ agents: [NO_CLAUDE, NO_CODEX], active: null }),
    ).toEqual({
      tone: "attention",
      text: "No coding agent found. Install Claude Code or Codex on the machine running dbu6. Without one, dbu6 can't categorize transactions, read new bank statements, or fix import problems. Check again once one is installed.",
      details: [],
      checkAgain: true,
    });
  });
});

describe("checkingModels", () => {
  it("is true only while the active agent's models are being checked", () => {
    const checkingCodex = codex({ state: "checking" });

    expect(
      checkingModels({ agents: [CLAUDE, checkingCodex], active: "codex" }),
    ).toBe(true);
    expect(
      checkingModels({
        agents: [CLAUDE, checkingCodex],
        active: "claude-code",
      }),
    ).toBe(false);
  });
});
