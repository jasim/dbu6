import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { SapportaEnv } from "@sapporta/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Detection is stubbed; the choice is saved for real in a temporary data
// directory.
const { detectLocalAgents } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({ detectLocalAgents }));

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

let dataDir: string;

beforeEach(async () => {
  vi.resetModules();
  detectLocalAgents.mockReset();
  dataDir = await mkdtemp(join(tmpdir(), "dbu6-coding-agent-api-"));
  vi.stubEnv("SAPPORTA_DATA_DIR", dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
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

    expect([get.status, put.status]).toEqual([403, 403]);
    expect(detectLocalAgents).not.toHaveBeenCalled();
  });

  it("uses the first installed agent until one is chosen", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);

    const response = await (await app()).request("/coding-agent");

    expect(await response.json()).toEqual({
      agents: [
        { agent: "claude-code", installed: true, logged_in: true },
        { agent: "codex", installed: true, logged_in: false },
      ],
      active: "claude-code",
    });
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
        await readFile(join(dataDir, "user-config", "settings.json"), "utf8"),
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
});
