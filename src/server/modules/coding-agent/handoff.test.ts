import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Detection, the models' replies and starting a session are stubbed: these
// tests are about which agent, model and files dbu6 asks nuabase for, and what
// it makes of the answer. The session's files and launcher are nuabase's, and
// tested there. The chosen agent is read from a temporary project root's
// user-config/.
const { detectLocalAgents, localAgent, direct, startAgentSession } = vi.hoisted(
  () => ({
    detectLocalAgents: vi.fn(),
    localAgent: vi.fn((config: object) => ({
      // A call's client is the agent with that call's options.
      with: (options: object) => ({ ...config, ...options }),
    })),
    direct: vi.fn(),
    startAgentSession: vi.fn(),
  }),
);
vi.mock("nuabase/local-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  detectLocalAgents,
  localAgent,
  startAgentSession,
}));
vi.mock("nuabase", () => ({ Nua: { direct } }));

// Detection and the model checks are kept, so each test loads it afresh.
let handoff: typeof import("./handoff.js");

/** Only these models answer; `undefined` is the agent's own default. */
function answering(...answered: (string | undefined)[]) {
  direct.mockImplementation(
    ({ localAgent: config }: { localAgent: { model?: string } }) => ({
      get: async () =>
        answered.includes(config.model)
          ? { success: true, data: "OK" }
          : {
              success: false,
              error: "LLM call failed: sample refusal",
              reason: "sample refusal",
            },
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
    loggedIn: true,
    binaryPath: "/sample/bin/codex",
  },
];
const NONE = [
  { agent: "claude-code", installed: false, loggedIn: false },
  { agent: "codex", installed: false, loggedIn: false },
];
const PI_ONLY = [
  { agent: "claude-code", installed: false, loggedIn: false },
  { agent: "codex", installed: false, loggedIn: false },
  {
    agent: "pi",
    installed: true,
    loggedIn: true,
    binaryPath: "/sample/bin/pi",
  },
];

const PROMPT =
  'Rerun with `curl -H "Authorization: Bearer $SAPPORTA_API_TOKEN"` and C:\\sample\\050505.';

let root: string;

const SESSION_FILES = {
  promptPath: "/sample/tmp/agent-prompts/sample.md",
  launcherPath: "/sample/tmp/agent-prompts/sample.command",
  command: "sh '/sample/tmp/agent-prompts/sample.command'",
};

// As nuabase starts a session: a terminal window on macOS, a command elsewhere.
async function started({ platform }: { platform: NodeJS.Platform }) {
  return platform === "darwin"
    ? { kind: "opened", files: SESSION_FILES }
    : { kind: "command", files: SESSION_FILES };
}

async function choose(agent: string) {
  await mkdir(join(root, "user-config"), { recursive: true });
  await writeFile(
    join(root, "user-config", "settings.json"),
    JSON.stringify({ coding_agent: agent }),
  );
}

beforeEach(async () => {
  vi.resetModules();
  // A fresh dbu_config for each test, bound as the runtime binds the table.
  const config = await import("../../dbu-config.js");
  config.useDbuConfig(config.memoryDbuConfig());
  handoff = await import("./handoff.js");
  detectLocalAgents.mockReset();
  direct.mockReset();
  answering("opus", "sonnet", "gpt-5.6-sol", "gpt-5.6-terra", undefined);
  startAgentSession.mockReset();
  startAgentSession.mockImplementation(started);
  root = await mkdtemp(join(tmpdir(), "dbu6-handoff-"));
  vi.stubEnv("DBU6_ROOT", root);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("agentHandoffAvailability", () => {
  it("opens the first installed agent in a terminal on macOS", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);

    expect(await handoff.agentHandoffAvailability("darwin")).toEqual({
      mode: "terminal",
      agent: "claude-code",
    });
  });

  it("opens the agent chosen in Settings", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    await choose("codex");

    expect(await handoff.agentHandoffAvailability("darwin")).toEqual({
      mode: "terminal",
      agent: "codex",
    });
  });

  it("gives a command to run on other POSIX systems", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    expect(await handoff.agentHandoffAvailability("linux")).toEqual({
      mode: "command",
      agent: "claude-code",
    });
  });

  it("offers nothing on Windows, which has no launcher", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);

    expect(await handoff.agentHandoffAvailability("win32")).toEqual({
      mode: "none",
    });
  });

  it("offers nothing when no agent is installed", async () => {
    detectLocalAgents.mockResolvedValue(NONE);

    expect(await handoff.agentHandoffAvailability("darwin")).toEqual({
      mode: "none",
    });
  });
});

describe("handOffPrompt", () => {
  it("starts the chosen agent on its most capable model, in the project, in its auto mode", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    await choose("codex");

    expect(await handoff.handOffPrompt(PROMPT, "linux", root)).toEqual({
      agent: "codex",
      mode: "command",
      prompt_path: SESSION_FILES.promptPath,
      launcher_path: SESSION_FILES.launcherPath,
      command: SESSION_FILES.command,
    });
    expect(startAgentSession).toHaveBeenCalledTimes(1);
    expect(startAgentSession).toHaveBeenCalledWith({
      agent: "codex",
      binaryPath: "/sample/bin/codex",
      cwd: root,
      model: "gpt-5.6-sol",
      approval: "auto",
      prompt: PROMPT,
      dir: join(root, "tmp", "agent-prompts"),
      platform: "linux",
    });
  });

  it("says a terminal window opened on macOS", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    const written = await handoff.handOffPrompt(PROMPT, "darwin", root);

    expect(written).toMatchObject({ agent: "claude-code", mode: "terminal" });
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opus", platform: "darwin" }),
    );
  });

  it("runs Pi without naming a model", async () => {
    detectLocalAgents.mockResolvedValue(PI_ONLY);
    await choose("pi");

    expect((await handoff.handOffPrompt(PROMPT, "linux", root)).agent).toBe(
      "pi",
    );
    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "pi", model: undefined }),
    );
  });

  it("falls to the model that answered", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    answering("sonnet");

    await handoff.handOffPrompt(PROMPT, "darwin", root);

    expect(startAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "sonnet" }),
    );
  });

  it("refuses when no coding agent is installed", async () => {
    detectLocalAgents.mockResolvedValue(NONE);

    await expect(
      handoff.handOffPrompt(PROMPT, "darwin", root),
    ).rejects.toMatchObject({
      error: "no_coding_agent",
      message:
        "No coding agent found. Install Claude Code or Codex or Pi on the machine running dbu6.",
    });
    expect(startAgentSession).not.toHaveBeenCalled();
  });

  it("refuses when no agent is chosen and none works", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    answering();

    await expect(
      handoff.handOffPrompt(PROMPT, "darwin", root),
    ).rejects.toMatchObject({
      error: "no_coding_agent",
      message: expect.stringContaining("None of the installed coding agents"),
    });
  });

  it("refuses when none of the chosen agent's models answered", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    const { saveChosenCodingAgent } = await import("./agents.js");
    await saveChosenCodingAgent("claude-code");
    answering();

    await expect(
      handoff.handOffPrompt(PROMPT, "darwin", root),
    ).rejects.toMatchObject({
      error: "no_agent_model",
      message: expect.stringContaining("Claude Code didn't answer on"),
    });
    expect(startAgentSession).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported_platform", "agent_handoff_unsupported"],
    ["prompt_too_long", "prompt_too_long"],
    ["agent_not_found", "agent_not_installed"],
  ])("refuses as nuabase did: %s", async (reason, error) => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    startAgentSession.mockResolvedValue({
      kind: "refused",
      reason,
      message: "sample refusal",
    });

    await expect(
      handoff.handOffPrompt(PROMPT, "linux", root),
    ).rejects.toMatchObject({ error, status: 400 });
  });

  it("gives the command when the terminal window doesn't open", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    startAgentSession.mockResolvedValue({
      kind: "open_failed",
      files: SESSION_FILES,
      error: "sample failure",
    });

    await expect(
      handoff.handOffPrompt(PROMPT, "darwin", root),
    ).rejects.toMatchObject({
      error: "terminal_open_failed",
      status: 500,
      message: `Couldn't open a terminal window (sample failure). Run this in a terminal instead: ${SESSION_FILES.command}`,
    });
  });
});
