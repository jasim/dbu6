import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { SapportaEnv } from "@sapporta/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Detection and the models' replies are stubbed; the choice is saved for real
// in a temporary project root.
const { detectLocalAgents, localAgent, direct } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
  localAgent: vi.fn((config: { model: string }) => config),
  direct: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({ detectLocalAgents, localAgent }));
vi.mock("nuabase", () => ({ Nua: { direct } }));

/** Only these models answer. */
function answering(...answered: string[]) {
  direct.mockImplementation(
    ({ localAgent: config }: { localAgent: { model: string } }) => ({
      get: async () =>
        answered.includes(config.model)
          ? { success: true, data: "OK" }
          : { success: false, error: "codex: sample refusal" },
    }),
  );
}

const CLAUDE_ONLY = [
  {
    agent: "claude-code",
    installed: true,
    loggedIn: true,
    binaryPath: "/sample/bin/claude",
  },
  { agent: "codex", installed: false, loggedIn: false },
];
const BOTH = [
  CLAUDE_ONLY[0],
  {
    agent: "codex",
    installed: true,
    loggedIn: false,
    binaryPath: "/sample/bin/codex",
  },
];

let projectDir: string;

beforeEach(async () => {
  vi.resetModules();
  detectLocalAgents.mockReset();
  localAgent.mockClear();
  direct.mockReset();
  answering("opus", "sonnet");
  projectDir = await mkdtemp(join(tmpdir(), "dbu6-coding-agent-api-"));
  vi.stubEnv("DBU6_ROOT", projectDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(projectDir, { recursive: true, force: true });
});

async function app(allowed = true) {
  const { default: api } = await import("./coding-agent.js");
  const hono = new Hono<SapportaEnv>();
  hono.use(async (c, next) => {
    c.set("auth", { ability: { can: () => allowed } } as never);
    await next();
  });
  hono.route("/", api);
  return hono;
}

function checkAgain(hono: Hono<SapportaEnv>) {
  return hono.request("/coding-agent/model-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

function choose(hono: Hono<SapportaEnv>, agent: string) {
  return hono.request("/coding-agent", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent }),
  });
}

describe("/coding-agent", () => {
  it("is forbidden without workflow access, before detecting anything", async () => {
    const hono = await app(false);

    const get = await hono.request("/coding-agent");
    const put = await choose(hono, "codex");
    const check = await checkAgain(hono);

    expect([get.status, put.status, check.status]).toEqual([403, 403, 403]);
    expect(detectLocalAgents).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });

  it("uses the first installed agent until one is chosen", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);

    const response = await (await app()).request("/coding-agent");

    expect(await response.json()).toEqual({
      agents: [
        {
          agent: "claude-code",
          installed: true,
          logged_in: true,
          models: { state: "checking" },
        },
        {
          agent: "codex",
          installed: true,
          logged_in: false,
          models: { state: "not_checked" },
        },
      ],
      active: "claude-code",
    });
  });

  it("shows the models a signed-in agent answered on once they are checked", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    answering("sonnet");
    const hono = await app();

    await hono.request("/coding-agent");
    await vi.waitFor(async () => {
      const [claude] = (await (await hono.request("/coding-agent")).json())
        .agents;
      expect(claude.models).toEqual({
        state: "ready",
        session: { model: "sonnet", label: "Claude Sonnet" },
        categorization: { model: "sonnet", label: "Claude Sonnet" },
        unavailable: [
          { model: "opus", label: "Claude Opus", reason: "sample refusal" },
        ],
      });
    });
    expect(direct).toHaveBeenCalledTimes(2);
  });

  it("saves the chosen agent", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    const hono = await app();

    const put = await choose(hono, "codex");

    expect(put.status).toBe(200);
    expect((await put.json()).active).toBe("codex");
    expect((await (await hono.request("/coding-agent")).json()).active).toBe(
      "codex",
    );
    expect(
      JSON.parse(
        await readFile(
          join(projectDir, "user-config", "settings.json"),
          "utf8",
        ),
      ),
    ).toEqual({ coding_agent: "codex" });
  });

  it("refuses an agent that isn't installed", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    const put = await choose(await app(), "codex");

    expect(put.status).toBe(400);
    expect(await put.json()).toEqual({
      error: "agent_not_installed",
      message: "Codex isn't installed on the machine running dbu6.",
    });
  });
  it("checks the active agent's models again when asked", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    answering("sonnet");
    const hono = await app();
    await hono.request("/coding-agent");
    await vi.waitFor(() => expect(direct).toHaveBeenCalledTimes(2));
    answering("opus", "sonnet");

    const check = await checkAgain(hono);

    expect(check.status).toBe(200);
    expect((await check.json()).agents[0].models).toEqual({
      state: "checking",
    });
    await vi.waitFor(async () => {
      const [claude] = (await (await hono.request("/coding-agent")).json())
        .agents;
      expect(claude.models).toMatchObject({
        state: "ready",
        session: { model: "opus" },
      });
    });
    expect(direct).toHaveBeenCalledTimes(4);
  });

  it("can't check again without an installed agent", async () => {
    detectLocalAgents.mockResolvedValue([
      { agent: "claude-code", installed: false, loggedIn: false },
      { agent: "codex", installed: false, loggedIn: false },
    ]);

    const check = await checkAgain(await app());

    expect(check.status).toBe(400);
    expect(await check.json()).toEqual({
      error: "no_coding_agent",
      message:
        "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
    });
  });
});
