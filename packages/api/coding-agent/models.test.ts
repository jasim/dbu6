import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedAgent, InstalledAgent } from "./nuabase.js";

// Nuabase is stubbed: each test says which models answer.
const { detectLocalAgents, localAgent, direct } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
  localAgent: vi.fn((config: { model: string }) => config),
  direct: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({ detectLocalAgents, localAgent }));
vi.mock("nuabase", () => ({ Nua: { direct } }));

// The module keeps each agent's check, so each test loads it afresh.
let models: typeof import("./models.js");

let dataDir: string;

const CODEX: InstalledAgent = {
  agent: "codex",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/codex",
};
const CLAUDE: InstalledAgent = {
  agent: "claude-code",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/claude",
};

const SOL = { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" };
const TERRA = { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" };

function refusal(model: string): string {
  return `codex: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The '${model}' model is not supported on this sample account."}}`;
}

/** Only these models answer; the rest are refused. */
function answering(...answered: string[]) {
  direct.mockImplementation(
    ({ localAgent: config }: { localAgent: { model: string } }) => ({
      get: async () =>
        answered.includes(config.model)
          ? { success: true, data: "OK" }
          : { success: false, error: refusal(config.model) },
    }),
  );
}

function askedModels(): string[] {
  return localAgent.mock.calls.map(([config]) => config.model);
}

beforeEach(async () => {
  vi.resetModules();
  models = await import("./models.js");
  detectLocalAgents.mockReset();
  localAgent.mockClear();
  direct.mockReset();
  // startCodingAgent logs the chosen agent, which reads user-config.
  dataDir = await mkdtemp(join(tmpdir(), "dbu6-agent-models-"));
  vi.stubEnv("SAPPORTA_DATA_DIR", dataDir);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dataDir, { recursive: true, force: true });
});

describe("agentModelsFrom", () => {
  it("opens prompts on the most capable model that answered, and categorizes on the least", () => {
    expect(
      models.agentModelsFrom([
        { model: SOL, answered: true },
        { model: TERRA, answered: true },
      ]),
    ).toEqual({
      state: "ready",
      session: SOL,
      categorization: TERRA,
      unavailable: [],
    });
  });

  it("uses the model below when the most capable doesn't answer", () => {
    expect(
      models.agentModelsFrom([
        { model: SOL, answered: false, reason: "sample refusal" },
        { model: TERRA, answered: true },
      ]),
    ).toEqual({
      state: "ready",
      session: TERRA,
      categorization: TERRA,
      unavailable: [{ ...SOL, reason: "sample refusal" }],
    });
  });

  it("uses a more capable model for categorization when the floor doesn't answer", () => {
    expect(
      models.agentModelsFrom([
        { model: SOL, answered: true },
        { model: TERRA, answered: false, reason: "sample refusal" },
      ]),
    ).toMatchObject({ state: "ready", session: SOL, categorization: SOL });
  });

  it("leaves the agent unusable when no model answers", () => {
    expect(
      models.agentModelsFrom([
        { model: SOL, answered: false, reason: "sample refusal" },
        { model: TERRA, answered: false, reason: "sample timeout" },
      ]),
    ).toEqual({
      state: "no_model",
      unavailable: [
        { ...SOL, reason: "sample refusal" },
        { ...TERRA, reason: "sample timeout" },
      ],
    });
  });
});

describe("agentModels", () => {
  it("asks Claude Code's Opus and Sonnet, and nothing less capable", async () => {
    answering("opus", "sonnet");

    expect(await models.agentModels(CLAUDE)).toEqual({
      state: "ready",
      session: { model: "opus", label: "Claude Opus" },
      categorization: { model: "sonnet", label: "Claude Sonnet" },
      unavailable: [],
    });
    expect(askedModels()).toEqual(["opus", "sonnet"]);
  });

  it("asks Codex's Sol and Terra on the detected executable, once for callers during the check", async () => {
    answering("gpt-5.6-terra");

    const [first, second] = await Promise.all([
      models.agentModels(CODEX),
      models.agentModels(CODEX),
    ]);

    expect(first).toEqual({
      state: "ready",
      session: TERRA,
      categorization: TERRA,
      unavailable: [
        {
          ...SOL,
          reason:
            "The 'gpt-5.6-sol' model is not supported on this sample account.",
        },
      ],
    });
    expect(second).toBe(first);
    expect(localAgent.mock.calls.map(([config]) => config)).toEqual([
      {
        agent: "codex",
        model: "gpt-5.6-sol",
        binaryPath: "/sample/bin/codex",
        timeoutMs: 60_000,
      },
      {
        agent: "codex",
        model: "gpt-5.6-terra",
        binaryPath: "/sample/bin/codex",
        timeoutMs: 60_000,
      },
    ]);
  });

  it("keeps a check where a model answered", async () => {
    answering("gpt-5.6-terra");
    await models.agentModels(CODEX);
    answering("gpt-5.6-sol", "gpt-5.6-terra");

    expect((await models.agentModels(CODEX)).state).toBe("ready");
    expect(askedModels()).toHaveLength(2);
  });

  it("checks again when no model answered last time", async () => {
    answering();
    expect((await models.agentModels(CODEX)).state).toBe("no_model");
    answering("gpt-5.6-terra");

    expect(await models.agentModels(CODEX)).toMatchObject({
      state: "ready",
      session: TERRA,
    });
    expect(askedModels()).toHaveLength(4);
  });

  it("checks again when the executable moved", async () => {
    answering("gpt-5.6-terra");
    await models.agentModels(CODEX);

    await models.agentModels({ ...CODEX, binaryPath: "/sample/other/codex" });

    expect(askedModels()).toHaveLength(4);
  });

  it("counts a call that throws as a model that didn't answer", async () => {
    direct.mockImplementation(() => {
      throw new Error("sample failure");
    });

    expect(await models.agentModels(CODEX)).toMatchObject({
      state: "no_model",
      unavailable: [
        { model: "gpt-5.6-sol", reason: "sample failure" },
        { model: "gpt-5.6-terra", reason: "sample failure" },
      ],
    });
  });
});

describe("checkAgentModelsAgain", () => {
  it("asks again even when a model answered", async () => {
    answering("gpt-5.6-terra");
    await models.agentModels(CODEX);
    answering("gpt-5.6-sol", "gpt-5.6-terra");

    expect(await models.checkAgentModelsAgain(CODEX)).toMatchObject({
      session: SOL,
      categorization: TERRA,
    });
    expect(await models.agentModels(CODEX)).toMatchObject({ session: SOL });
  });
});

describe("agentModelsNow", () => {
  it("doesn't check an agent that isn't installed or signed in", () => {
    const signedOut: DetectedAgent = { ...CODEX, loggedIn: false };

    expect(
      models.agentModelsNow({
        agent: "codex",
        installed: false,
        loggedIn: false,
      }),
    ).toEqual({ state: "not_checked" });
    expect(models.agentModelsNow(signedOut)).toEqual({ state: "not_checked" });
    expect(direct).not.toHaveBeenCalled();
  });

  it("shows the check running, then its result, without checking again", async () => {
    answering();

    expect(models.agentModelsNow(CODEX)).toEqual({ state: "checking" });
    await models.agentModels(CODEX);
    expect(models.agentModelsNow(CODEX)).toMatchObject({ state: "no_model" });
    expect(models.agentModelsNow(CODEX)).toMatchObject({ state: "no_model" });
    expect(askedModels()).toHaveLength(2);
  });
});

describe("startCodingAgent", () => {
  it("checks the agent dbu6 will use, and no other signed-in agent", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX]);
    answering("opus", "sonnet");

    await models.startCodingAgent();

    expect(askedModels()).toEqual(["opus", "sonnet"]);
    expect(models.agentModelsNow(CLAUDE)).toMatchObject({ state: "ready" });
  });

  it("checks nothing when the agent isn't signed in", async () => {
    detectLocalAgents.mockResolvedValue([{ ...CLAUDE, loggedIn: false }]);

    await models.startCodingAgent();

    expect(direct).not.toHaveBeenCalled();
  });
});
