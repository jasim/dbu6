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

// The module keeps detection for a minute, so each test loads it afresh.
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

let dataDir: string;

beforeEach(async () => {
  vi.resetModules();
  agents = await import("./agents.js");
  detectLocalAgents.mockReset();
  dataDir = await mkdtemp(join(tmpdir(), "dbu6-coding-agent-"));
  vi.stubEnv("SAPPORTA_DATA_DIR", dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
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
    const path = join(dataDir, "user-config", "settings.json");
    await mkdir(join(dataDir, "user-config"));
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

describe("detectCodingAgents", () => {
  it("detects again once a minute has passed, or when asked", async () => {
    vi.useFakeTimers();
    try {
      detectLocalAgents.mockResolvedValueOnce([NO_CLAUDE, NO_CODEX]);
      detectLocalAgents.mockResolvedValueOnce([CLAUDE, NO_CODEX]);
      detectLocalAgents.mockResolvedValueOnce([CLAUDE, CODEX]);

      expect(await agents.detectCodingAgents()).toEqual([NO_CLAUDE, NO_CODEX]);
      vi.advanceTimersByTime(59_000);
      expect(await agents.detectCodingAgents()).toEqual([NO_CLAUDE, NO_CODEX]);
      vi.advanceTimersByTime(1_000);
      expect(await agents.detectCodingAgents()).toEqual([CLAUDE, NO_CODEX]);
      expect(await agents.detectCodingAgents({ fresh: true })).toEqual([
        CLAUDE,
        CODEX,
      ]);
      expect(detectLocalAgents).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
