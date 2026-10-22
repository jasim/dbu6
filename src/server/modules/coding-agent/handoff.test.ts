import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Detection, the models' replies and opening a terminal are stubbed; nuabase
// writes the files for real under a temporary project root, and the chosen
// agent is read from its user-config/.
const { detectLocalAgents, localAgent, direct, openInTerminal } = vi.hoisted(
  () => ({
    detectLocalAgents: vi.fn(),
    localAgent: vi.fn((config: { model: string }) => config),
    direct: vi.fn(),
    openInTerminal: vi.fn(),
  }),
);
vi.mock("nuabase/local-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  detectLocalAgents,
  localAgent,
  openInTerminal,
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
  localAgent.mockClear();
  direct.mockReset();
  answering("opus", "sonnet", "gpt-5.6-sol", "gpt-5.6-terra", undefined);
  openInTerminal.mockReset();
  openInTerminal.mockResolvedValue(undefined);
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
  it("writes the prompt and a launcher that runs the chosen agent on it", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    await choose("codex");

    const written = await handoff.handOffPrompt(PROMPT, "linux", root);

    expect(written.agent).toBe("codex");
    expect(written.mode).toBe("command");
    const { prompt_path, launcher_path, command } = written;
    const dir = join(root, "tmp", "agent-prompts");
    expect(prompt_path).toMatch(
      new RegExp(
        `^${dir}/\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-codex-[0-9a-f]{4}\\.md$`,
      ),
    );
    expect(launcher_path).toBe(prompt_path.replace(/\.md$/, ".command"));
    expect(command).toBe(`sh '${launcher_path}'`);

    expect(await readFile(prompt_path, "utf8")).toBe(PROMPT);
    expect((await stat(prompt_path)).mode & 0o777).toBe(0o600);
    expect(await readFile(launcher_path, "utf8")).toBe(
      [
        "#!/bin/sh",
        `cd '${root}' || exit 1`,
        `exec '/sample/bin/codex' '--model' 'gpt-5.6-sol' '--approve-for-me' -- "$(cat '${prompt_path}')"`,
        "",
      ].join("\n"),
    );
    expect((await stat(launcher_path)).mode & 0o777).toBe(0o700);
    expect(openInTerminal).not.toHaveBeenCalled();
  });

  it("opens the launcher in a terminal on macOS, on the agent's most capable model", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    const written = await handoff.handOffPrompt(PROMPT, "darwin", root);

    expect(written.mode).toBe("terminal");
    expect(await readFile(written.launcher_path, "utf8")).toContain(
      `'--model' 'opus' '--permission-mode' 'auto'`,
    );
    expect(openInTerminal).toHaveBeenCalledTimes(1);
    expect(openInTerminal).toHaveBeenCalledWith(
      written.launcher_path,
      "darwin",
    );
  });

  it("runs Pi without naming a model, trusting the project's files", async () => {
    detectLocalAgents.mockResolvedValue(PI_ONLY);
    await choose("pi");

    const written = await handoff.handOffPrompt(PROMPT, "linux", root);

    expect(written.agent).toBe("pi");
    const launcher = await readFile(written.launcher_path, "utf8");
    expect(launcher).toContain(`'/sample/bin/pi' '--approve' -- "$(cat '`);
    expect(launcher).not.toContain("--model");
  });

  it("falls to the model that answered", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    answering("sonnet");

    const written = await handoff.handOffPrompt(PROMPT, "darwin", root);

    expect(await readFile(written.launcher_path, "utf8")).toContain(
      `'--model' 'sonnet'`,
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
    await expect(stat(join(root, "tmp"))).rejects.toThrow();
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
    await expect(stat(join(root, "tmp"))).rejects.toThrow();
  });

  it("refuses a prompt too long for one argument on Linux", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    const prompt = "x".repeat(131_072);

    await expect(
      handoff.handOffPrompt(prompt, "linux", root),
    ).rejects.toMatchObject({ error: "prompt_too_long" });
    expect((await handoff.handOffPrompt(prompt, "darwin", root)).mode).toBe(
      "terminal",
    );
  });

  it("refuses on Windows, which has no launcher", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    await expect(
      handoff.handOffPrompt(PROMPT, "win32", root),
    ).rejects.toMatchObject({ error: "agent_handoff_unsupported" });
  });

  it("gives the command when the terminal doesn't open, with the files written", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    openInTerminal.mockRejectedValue(new Error("sample failure"));

    await expect(
      handoff.handOffPrompt(PROMPT, "darwin", root),
    ).rejects.toMatchObject({
      error: "terminal_open_failed",
      status: 500,
      message: expect.stringContaining("Run this in a terminal instead: sh '"),
    });
    const [launcherPath] = openInTerminal.mock.calls[0] as string[];
    expect((await stat(launcherPath)).isFile()).toBe(true);
  });
});
