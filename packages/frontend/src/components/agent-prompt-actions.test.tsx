// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AgentHandoffAvailability } from "dbu6-shared";
import { AgentPromptActions } from "./agent-prompt-actions";

/*
 * Copy prompt always shows; an Open or Command button shows for the agent
 * the server can start, and a click shows what happened.
 */

let host: HTMLDivElement;
let root: Root;
let availability: { status: number; body: unknown };
let handoff: { status: number; body: unknown };
let posts: unknown[];

const PROMPT = "Build a parser for NOPII sample statement 050505.";
const LAUNCHER = "/sample/dbu6/tmp/agent-prompts/sample-claude-code.command";

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posts = [];
  handoff = {
    status: 200,
    body: {
      agent: "claude-code",
      mode: "terminal",
      prompt_path: LAUNCHER.replace(/\.command$/, ".md"),
      launcher_path: LAUNCHER,
      command: `sh '${LAUNCHER}'`,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const method = request?.method ?? init?.method ?? "GET";
      if (method === "POST") {
        const body = request ? await request.text() : String(init?.body);
        posts.push(JSON.parse(body));
        return Response.json(handoff.body, { status: handoff.status });
      }
      return Response.json(availability.body, { status: availability.status });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function offers(body: AgentHandoffAvailability) {
  availability = { status: 200, body };
}

/** The handoff the server reports for a click. */
function handedOffIn(mode: "terminal" | "command", agent = "claude-code") {
  handoff = { ...handoff, body: { ...(handoff.body as object), agent, mode } };
}

let client: QueryClient;

async function render(prompt = PROMPT) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await rerender(prompt);
}

async function rerender(prompt: string) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AgentPromptActions, { prompt }),
      ),
    );
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buttons(): string[] {
  return [...host.querySelectorAll("button")].map((b) => b.textContent ?? "");
}

async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => {
    button.click();
  });
  await settle();
}

describe("AgentPromptActions", () => {
  it("opens the agent dbu6 uses in a terminal on macOS", async () => {
    offers({ mode: "terminal", agent: "codex" });
    await render();

    expect(buttons()).toEqual(["Copy prompt", "Open in Codex"]);
  });

  it("offers a command where no terminal can be opened", async () => {
    offers({ mode: "command", agent: "codex" });
    await render();

    expect(buttons()).toEqual(["Copy prompt", "Command for Codex"]);
  });

  it("offers only Copy prompt when the server hands nothing off, or can't be asked", async () => {
    offers({ mode: "none" });
    await render();
    expect(buttons()).toEqual(["Copy prompt"]);

    availability = { status: 403, body: { error: "Forbidden" } };
    await render();
    expect(buttons()).toEqual(["Copy prompt"]);
  });

  it("asks the server to open the agent, and says where to answer it", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render();

    await click("Open in Claude Code");

    expect(posts).toEqual([{ prompt: PROMPT }]);
    expect(host.textContent).toContain(
      "Claude Code opened in a new terminal window. Answer it there.",
    );
    expect(host.querySelector("summary")?.textContent).toContain(
      "Didn't open?",
    );
    expect(host.querySelector("code")?.textContent).toBe(`sh '${LAUNCHER}'`);
  });

  it("shows the command to run after a Command click", async () => {
    offers({ mode: "command", agent: "claude-code" });
    handedOffIn("command");
    await render();

    await click("Command for Claude Code");

    expect(posts).toEqual([{ prompt: PROMPT }]);
    expect(host.textContent).toContain(
      "Run this in a terminal to start Claude Code on the prompt",
    );
    expect(host.querySelector("code")?.textContent).toBe(`sh '${LAUNCHER}'`);
    expect(buttons()).toContain("Copy");
  });

  it("names the agent the server actually started, not the one the button named", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    handedOffIn("terminal", "codex");
    await render();

    await click("Open in Claude Code");

    expect(host.textContent).toContain(
      "Codex opened in a new terminal window.",
    );
  });

  it("drops the result when the prompt changes", async () => {
    offers({ mode: "command", agent: "claude-code" });
    handedOffIn("command");
    await render();
    await click("Command for Claude Code");
    expect(host.querySelector("code")).not.toBeNull();

    await rerender("A different NOPII sample prompt.");

    expect(host.querySelector("code")).toBeNull();
    expect(host.textContent).not.toContain("Run this in a terminal");
  });

  it("shows the server's message when the handoff fails", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    handoff = {
      status: 500,
      body: {
        error: "terminal_open_failed",
        message: "Couldn't open a terminal window (sample failure).",
      },
    };
    await render();

    await click("Open in Claude Code");

    expect(host.textContent).toContain(
      "Couldn't open a terminal window (sample failure).",
    );
    expect(host.textContent).not.toContain("opened in a new terminal window");
  });
});
