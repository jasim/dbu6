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
import { Hono } from "hono";
import type { SapportaEnv } from "@sapporta/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHandoffRequest } from "dbu6-shared";

// Detection and `open` are stubbed; the files are written for real under a
// temporary project root, and the chosen agent is read from a temporary data
// directory.
const { detectLocalAgents, execFile } = vi.hoisted(() => ({
  detectLocalAgents: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("nuabase/local-agent", () => ({ detectLocalAgents }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile,
}));

// Detection is kept for a minute, so each test loads the handler afresh.
let handoff: typeof import("./agent-handoff.js");

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
const NONE = [
  { agent: "claude-code", installed: false, loggedIn: false },
  { agent: "codex", installed: false, loggedIn: false },
];

const PROMPT =
  'Rerun with `curl -H "Authorization: Bearer $SAPPORTA_API_TOKEN"` and C:\\sample\\050505.';

function request(
  overrides: Partial<AgentHandoffRequest> = {},
): AgentHandoffRequest {
  return { prompt: PROMPT, open: false, ...overrides };
}

let root: string;
let dataDir: string;

async function choose(agent: string) {
  await mkdir(join(dataDir, "user-config"), { recursive: true });
  await writeFile(
    join(dataDir, "user-config", "settings.json"),
    JSON.stringify({ coding_agent: agent }),
  );
}

beforeEach(async () => {
  vi.resetModules();
  handoff = await import("./agent-handoff.js");
  detectLocalAgents.mockReset();
  execFile.mockReset();
  execFile.mockImplementation((_file, _args, callback) =>
    callback(null, "", ""),
  );
  root = await mkdtemp(join(tmpdir(), "dbu6-handoff-"));
  dataDir = await mkdtemp(join(tmpdir(), "dbu6-handoff-data-"));
  vi.stubEnv("SAPPORTA_DATA_DIR", dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

describe("/agent-handoff routes", () => {
  it("are forbidden without workflow access, before detecting anything", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(async (c, next) => {
      c.set("auth", { ability: { can: () => false } } as never);
      await next();
    });
    app.route("/", handoff.default);

    const get = await app.request("/agent-handoff");
    const post = await app.request("/agent-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request({ open: true })),
    });

    expect([get.status, post.status]).toEqual([403, 403]);
    expect(detectLocalAgents).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe("GET /agent-handoff capabilities", () => {
  it("opens the first installed agent in a terminal on macOS", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);

    expect(await handoff.agentHandoffCapabilities("darwin")).toEqual({
      agent: "claude-code",
      open_terminal: true,
      shell_command: true,
    });
  });

  it("opens the agent chosen in Settings", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    await choose("codex");

    expect((await handoff.agentHandoffCapabilities("darwin")).agent).toBe(
      "codex",
    );
  });

  it("offers only the command on other POSIX systems", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    expect(await handoff.agentHandoffCapabilities("linux")).toEqual({
      agent: "claude-code",
      open_terminal: false,
      shell_command: true,
    });
  });

  it("offers neither on Windows", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);

    expect(await handoff.agentHandoffCapabilities("win32")).toEqual({
      agent: "claude-code",
      open_terminal: false,
      shell_command: false,
    });
  });

  it("offers neither when no agent is installed", async () => {
    detectLocalAgents.mockResolvedValue(NONE);

    expect(await handoff.agentHandoffCapabilities("darwin")).toEqual({
      agent: null,
      open_terminal: false,
      shell_command: false,
    });
  });
});

describe("POST /agent-handoff", () => {
  it("writes the prompt and a launcher that runs the chosen agent on it", async () => {
    detectLocalAgents.mockResolvedValue(BOTH);
    await choose("codex");

    const response = await handoff.handOffPrompt(request(), "linux", root);

    expect(response.status).toBe(200);
    if (response.status !== 200) return;
    const { prompt_path, launcher_path, command } = response.body;
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
        `exec '/sample/bin/codex' -- "$(cat '${prompt_path}')"`,
        "",
      ].join("\n"),
    );
    expect((await stat(launcher_path)).mode & 0o777).toBe(0o700);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("opens the launcher in a terminal on macOS", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    const response = await handoff.handOffPrompt(
      request({ open: true }),
      "darwin",
      root,
    );

    expect(response.status).toBe(200);
    if (response.status !== 200) return;
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0].slice(0, 2)).toEqual([
      "open",
      [response.body.launcher_path],
    ]);
  });

  it("refuses when no coding agent is installed", async () => {
    detectLocalAgents.mockResolvedValue(NONE);

    const response = await handoff.handOffPrompt(request(), "darwin", root);

    expect(response).toEqual({
      status: 400,
      body: {
        error: "no_coding_agent",
        message:
          "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
      },
    });
    await expect(stat(join(root, "tmp"))).rejects.toThrow();
  });

  it("refuses to open a terminal on Linux", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    const response = await handoff.handOffPrompt(
      request({ open: true }),
      "linux",
      root,
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "terminal_unavailable" });
    expect(execFile).not.toHaveBeenCalled();
    await expect(stat(join(root, "tmp"))).rejects.toThrow();
  });

  it("refuses a prompt too long for one argument on Linux", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    const prompt = "x".repeat(131_072);

    const onLinux = await handoff.handOffPrompt(
      request({ prompt }),
      "linux",
      root,
    );
    expect(onLinux.status).toBe(400);
    expect(onLinux.body).toMatchObject({ error: "prompt_too_long" });

    const onMac = await handoff.handOffPrompt(
      request({ prompt }),
      "darwin",
      root,
    );
    expect(onMac.status).toBe(200);
  });

  it("refuses on Windows, which has no launcher", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);

    const response = await handoff.handOffPrompt(request(), "win32", root);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "agent_handoff_unsupported" });
  });

  it("gives the command when the terminal doesn't open, with the files written", async () => {
    detectLocalAgents.mockResolvedValue(CLAUDE_ONLY);
    execFile.mockImplementation((_file, _args, callback) =>
      callback(new Error("sample failure"), "", ""),
    );

    const response = await handoff.handOffPrompt(
      request({ open: true }),
      "darwin",
      root,
    );

    expect(response.status).toBe(500);
    const [launcherPath] = execFile.mock.calls[0][1] as string[];
    expect(response.body).toEqual({
      error: "terminal_open_failed",
      message: `Couldn't open a terminal window (sample failure). Run this in a terminal instead: sh '${launcherPath}'`,
    });
    expect((await stat(launcherPath)).isFile()).toBe(true);
  });
});
