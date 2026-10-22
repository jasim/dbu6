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
let agents: typeof import("./agents.js");

const chosen = () => agents.chosenCodingAgent();
const saveChosen = (agent: "claude-code" | "codex" | "pi") =>
  agents.saveChosenCodingAgent(agent);

let projectDir: string;

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
const PI: InstalledAgent = {
  agent: "pi",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/pi",
};

const SOL = { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" };
const TERRA = { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" };

/** A failed call, as nuabase answers it. */
function refusal(model: string | undefined) {
  const reason = `The '${model}' model is not supported on this sample account.`;
  return { success: false, error: `LLM call failed: ${reason}`, reason };
}

/** Only these models answer; the rest are refused. `undefined` is the default. */
function answering(...answered: (string | undefined)[]) {
  direct.mockImplementation(
    ({ localAgent: config }: { localAgent: { model?: string } }) => ({
      get: async () =>
        answered.includes(config.model)
          ? { success: true, data: "OK" }
          : refusal(config.model),
    }),
  );
}

function askedModels(): (string | undefined)[] {
  return localAgent.mock.calls.map(([config]) => config.model);
}

beforeEach(async () => {
  vi.resetModules();
  // A fresh dbu_config for each test, bound as the runtime binds the table.
  const config = await import("../../dbu-config.js");
  config.useDbuConfig(config.memoryDbuConfig());
  models = await import("./models.js");
  agents = await import("./agents.js");
  detectLocalAgents.mockReset();
  localAgent.mockClear();
  direct.mockReset();
  // startCodingAgent logs the chosen agent, which reads user-config.
  projectDir = await mkdtemp(join(tmpdir(), "dbu6-agent-models-"));
  vi.stubEnv("DBU6_ROOT", projectDir);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(projectDir, { recursive: true, force: true });
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
        logger: expect.anything(),
      },
      {
        agent: "codex",
        model: "gpt-5.6-terra",
        binaryPath: "/sample/bin/codex",
        timeoutMs: 60_000,
        logger: expect.anything(),
      },
    ]);
  });

  it("asks Pi only its configured default, naming no model", async () => {
    answering(undefined);

    expect(await models.agentModels(PI)).toEqual({
      state: "ready",
      session: { label: "Pi's default" },
      categorization: { label: "Pi's default" },
      unavailable: [],
    });
    expect(askedModels()).toEqual([undefined]);
  });

  it("keeps a check where a model answered", async () => {
    answering("gpt-5.6-terra");
    await models.agentModels(CODEX);
    answering("gpt-5.6-sol", "gpt-5.6-terra");

    expect((await models.agentModels(CODEX)).state).toBe("ready");
    expect(askedModels()).toHaveLength(2);
  });

  it("keeps a check where no model answered, until asked again", async () => {
    answering();
    expect((await models.agentModels(CODEX)).state).toBe("no_model");
    answering("gpt-5.6-terra");

    expect((await models.agentModels(CODEX)).state).toBe("no_model");
    expect(askedModels()).toHaveLength(2);
    expect(await models.checkAgentModelsAgain(CODEX)).toMatchObject({
      state: "ready",
      session: TERRA,
    });
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

  it("detects and checks nothing when dbu_config already has both", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX]);
    answering("opus", "sonnet");
    await models.startCodingAgent();
    detectLocalAgents.mockClear();
    localAgent.mockClear();

    await models.startCodingAgent();

    expect(detectLocalAgents).not.toHaveBeenCalled();
    expect(askedModels()).toEqual([]);
  });

  it("checks nothing when no agent is signed in", async () => {
    detectLocalAgents.mockResolvedValue([{ ...CLAUDE, loggedIn: false }]);

    await models.startCodingAgent();

    expect(direct).not.toHaveBeenCalled();
    expect(await chosen()).toBeNull();
  });

  it("stays on the chosen agent when it doesn't work, and asks no other", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX]);
    await saveChosen("claude-code");
    answering("gpt-5.6-sol");

    await models.startCodingAgent();

    expect(askedModels()).toEqual(["opus", "sonnet"]);
    expect(await chosen()).toBe("claude-code");
  });
});

describe("pickCodingAgent", () => {
  it("saves the first agent that works, and asks none after it", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX, PI]);
    answering("gpt-5.6-terra", undefined);

    await models.pickCodingAgent();

    expect(askedModels()).toEqual([
      "opus",
      "sonnet",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    expect(await chosen()).toBe("codex");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("skips an agent that isn't signed in without asking it", async () => {
    detectLocalAgents.mockResolvedValue([
      { ...CLAUDE, loggedIn: false },
      CODEX,
      PI,
    ]);
    answering("gpt-5.6-sol");

    await models.pickCodingAgent();

    expect(askedModels()).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
    expect(await chosen()).toBe("codex");
  });

  it("chooses nothing when no agent works", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX, PI]);
    answering();

    await models.pickCodingAgent();

    expect(await chosen()).toBeNull();
    expect(await models.currentCodingAgent()).toEqual({
      agent: null,
      why: { kind: "none_works" },
    });
  });

  it("keeps a choice made while it runs", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX, PI]);
    // Opus answers only once the user has chosen Pi.
    let chose = () => {};
    const choosing = new Promise<void>((resolve) => (chose = resolve));
    direct.mockImplementation(() => ({
      get: async () => {
        await choosing;
        return { success: true, data: "OK" };
      },
    }));

    const pick = models.pickCodingAgent();
    await saveChosen("pi");
    chose();
    await pick;

    expect(await chosen()).toBe("pi");
  });

  it("is shared by callers while it runs", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX, PI]);
    answering("opus", "sonnet");

    const first = models.pickCodingAgent();
    expect(models.pickingCodingAgent()).toBe(true);
    await Promise.all([first, models.pickCodingAgent()]);

    expect(askedModels()).toEqual(["opus", "sonnet"]);
    expect(models.pickingCodingAgent()).toBe(false);
  });
});

describe("categorization after a failed call", () => {
  async function readyLlm() {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX]);
    answering("opus", "sonnet");
    await models.startCodingAgent();
    const { categorizationLlm } = await import("./categorization-llm.js");
    const llm = await categorizationLlm();
    if (!llm.caller.ready) throw new Error("Claude Code should be ready");
    return { categorizationLlm, caller: llm.caller };
  }

  it("keeps the agent unusable when the model check fails too, so later runs skip it", async () => {
    const { categorizationLlm, caller } = await readyLlm();
    // The user's plan has expired since the check.
    answering();
    localAgent.mockClear();

    const reason = await caller.confirmUnavailable();

    expect(reason).toMatch(
      /^Claude Code didn't answer on Claude Opus or Claude Sonnet/,
    );
    expect(askedModels()).toEqual(["opus", "sonnet"]);
    localAgent.mockClear();
    expect((await categorizationLlm()).caller).toEqual({
      ready: false,
      reason,
    });
    expect(askedModels()).toEqual([]);
  });

  it("keeps using the agent when the model check still answers", async () => {
    const { categorizationLlm, caller } = await readyLlm();

    expect(await caller.confirmUnavailable()).toBeNull();
    expect((await categorizationLlm()).caller.ready).toBe(true);
  });
});
