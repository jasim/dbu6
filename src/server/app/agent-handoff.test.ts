import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { SapportaEnv } from "@sapporta/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the handoff itself does is coding-agent/handoff.test.ts's business;
// these tests are about the routes: access, and the refusals they pass on.
const { agentHandoffAvailability, handOffPrompt } = vi.hoisted(() => ({
  agentHandoffAvailability: vi.fn(),
  handOffPrompt: vi.fn(),
}));
vi.mock("../modules/coding-agent/handoff.js", () => ({
  agentHandoffAvailability,
  handOffPrompt,
}));

import {
  NoCodingAgentError,
  TerminalOpenFailedError,
} from "../modules/coding-agent/index.js";
import api from "./agent-handoff.js";

const HANDOFF = {
  agent: "claude-code",
  mode: "terminal",
  prompt_path: "/sample/dbu6/tmp/agent-prompts/sample.md",
  launcher_path: "/sample/dbu6/tmp/agent-prompts/sample.command",
  command: "sh '/sample/dbu6/tmp/agent-prompts/sample.command'",
};

let root: string;

function app(allowed = true) {
  const hono = new Hono<SapportaEnv>();
  hono.use(async (c, next) => {
    c.set("auth", { ability: { can: () => allowed } } as never);
    await next();
  });
  hono.route("/", api);
  return hono;
}

function post(hono: Hono<SapportaEnv>, prompt = "Fix this import.") {
  return hono.request("/agent-handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

beforeEach(async () => {
  agentHandoffAvailability.mockReset();
  handOffPrompt.mockReset();
  agentHandoffAvailability.mockResolvedValue({
    mode: "terminal",
    agent: "claude-code",
  });
  handOffPrompt.mockResolvedValue(HANDOFF);
  root = await mkdtemp(join(tmpdir(), "dbu6-handoff-routes-"));
  vi.stubEnv("DBU6_ROOT", root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("/agent-handoff routes", () => {
  it("are forbidden without workflow access, before anything is written", async () => {
    const hono = app(false);

    const get = await hono.request("/agent-handoff");
    const posted = await post(hono);

    expect([get.status, posted.status]).toEqual([403, 403]);
    expect(agentHandoffAvailability).not.toHaveBeenCalled();
    expect(handOffPrompt).not.toHaveBeenCalled();
  });

  it("says how a prompt can be handed off on this machine", async () => {
    const response = await app().request("/agent-handoff");

    expect(await response.json()).toEqual({
      mode: "terminal",
      agent: "claude-code",
    });
    expect(agentHandoffAvailability).toHaveBeenCalledWith(process.platform);
  });

  it("hands the prompt off and answers with the agent and how it opened", async () => {
    const response = await post(app(), "Write a parser for this format.");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HANDOFF);
    expect(handOffPrompt.mock.calls[0].slice(0, 2)).toEqual([
      "Write a parser for this format.",
      process.platform,
    ]);
  });

  it("refuses with the reason the handoff gave", async () => {
    handOffPrompt.mockRejectedValue(new NoCodingAgentError());

    const response = await post(app());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "no_coding_agent",
      message:
        "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
    });
  });

  it("answers 500 when the terminal didn't open", async () => {
    handOffPrompt.mockRejectedValue(
      new TerminalOpenFailedError("sample failure", "sh '/sample/launcher'"),
    );

    const response = await post(app());

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("terminal_open_failed");
  });

  it("lets a server fault through to the default handler", async () => {
    handOffPrompt.mockRejectedValue(new Error("sample fault"));

    const response = await app().request("/agent-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Fix this import." }),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("no_coding_agent");
  });
});
