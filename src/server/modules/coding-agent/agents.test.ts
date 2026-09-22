import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedAgent } from "./nuabase.js";

const { detectLocalAgents } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({
  detectLocalAgents,
  localAgent: vi.fn(),
}));
vi.mock("nuabase", () => ({ Nua: { direct: vi.fn(), gateway: vi.fn() } }));

// The module shares a detection under way, so each test loads it afresh.
let agents: typeof import("./agents.js");

const CLAUDE: DetectedAgent = {
  agent: "claude-code",
  installed: true,
  loggedIn: true,
  binaryPath: "/sample/bin/claude",
};
const CODEX: DetectedAgent = {
  agent: "codex",
  installed: true,
  loggedIn: false,
  binaryPath: "/sample/bin/codex",
};
const NO_CLAUDE: DetectedAgent = {
  agent: "claude-code",
  installed: false,
  loggedIn: false,
};
const NO_CODEX: DetectedAgent = {
  agent: "codex",
  installed: false,
  loggedIn: false,
};

let projectDir: string;

beforeEach(async () => {
  vi.resetModules();
  // A fresh dbu_config for each test, bound as the runtime binds the table.
  const config = await import("../../dbu-config.js");
  config.useDbuConfig(config.memoryDbuConfig());
  agents = await import("./agents.js");
  detectLocalAgents.mockReset();
  projectDir = await mkdtemp(join(tmpdir(), "dbu6-coding-agent-"));
  vi.stubEnv("DBU6_ROOT", projectDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(projectDir, { recursive: true, force: true });
});

describe("activeCodingAgent", () => {
  it("uses the chosen agent when it is installed", () => {
    expect(agents.activeCodingAgent([CLAUDE, CODEX], "codex")).toBe(CODEX);
  });

  it("uses the first installed agent until one is chosen", () => {
    expect(agents.activeCodingAgent([CLAUDE, CODEX], null)).toBe(CLAUDE);
    expect(agents.activeCodingAgent([NO_CLAUDE, CODEX], null)).toBe(CODEX);
  });

  it("falls back to an installed agent when the chosen one is gone", () => {
    expect(agents.activeCodingAgent([CLAUDE, NO_CODEX], "codex")).toBe(CLAUDE);
  });

  it("is null when no agent is installed", () => {
    expect(agents.activeCodingAgent([NO_CLAUDE, NO_CODEX], "codex")).toBeNull();
  });
});

describe("the chosen agent", () => {
  it("is none until one is saved", async () => {
    expect(await agents.chosenCodingAgent()).toBeNull();
  });

  it("is saved in user-config/settings.json, keeping other settings", async () => {
    const path = join(projectDir, "user-config", "settings.json");
    await mkdir(join(projectDir, "user-config"));
    await writeFile(path, JSON.stringify({ sample_setting: "sample" }));

    await agents.saveChosenCodingAgent("codex");

    expect(await agents.chosenCodingAgent()).toBe("codex");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      sample_setting: "sample",
      coding_agent: "codex",
    });
  });

  it("drives the current agent", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX]);

    expect((await agents.currentCodingAgent())?.agent).toBe("claude-code");
    await agents.saveChosenCodingAgent("codex");
    expect((await agents.currentCodingAgent())?.agent).toBe("codex");
  });
});

describe("codingAgents", () => {
  it("detects once, keeps the result in dbu_config, and detects again only when asked", async () => {
    detectLocalAgents.mockResolvedValueOnce([NO_CLAUDE, NO_CODEX]);
    detectLocalAgents.mockResolvedValueOnce([CLAUDE, CODEX]);

    expect(await agents.codingAgents()).toEqual([NO_CLAUDE, NO_CODEX]);
    expect(await agents.codingAgents()).toEqual([NO_CLAUDE, NO_CODEX]);
    expect(await agents.detectCodingAgentsAgain()).toEqual([CLAUDE, CODEX]);
    expect(await agents.codingAgents()).toEqual([CLAUDE, CODEX]);
    expect(detectLocalAgents).toHaveBeenCalledTimes(2);
  });

  it("shares a detection under way", async () => {
    detectLocalAgents.mockResolvedValue([CLAUDE, CODEX]);

    await Promise.all([agents.codingAgents(), agents.codingAgents()]);

    expect(detectLocalAgents).toHaveBeenCalledTimes(1);
  });
});
