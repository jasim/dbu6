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
import { AgentPrompt } from "./agent-prompt";

/*
 * The panel shows its title and its buttons and nothing else to read. Copy
 * prompt always shows; an Open or Command button shows for the agent the
 * server can start, and a click shows what happened. What the user does next
 * waits until they have taken the prompt somewhere.
 */

let host: HTMLDivElement;
let root: Root;
let availability: { status: number; body: unknown };
let handoff: { status: number; body: unknown };
let posts: unknown[];

const PROMPT = "Build a parser for NOPII sample statement 050505.";
const TITLE = "Build a reader for this file's layout";
const AFTERWARDS = "Drop the file again once the agent says it is done.";
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async () => {} },
  });
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

async function render(prompt = PROMPT, afterwards?: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await rerender(prompt, afterwards);
}

async function rerender(prompt: string, afterwards?: string) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AgentPrompt, { title: TITLE, prompt, afterwards }),
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

describe("AgentPrompt", () => {
  it("says what the prompt gets done, and leaves the buttons to say the rest", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render(PROMPT, AFTERWARDS);

    expect(host.querySelector("h3")?.textContent).toBe(TITLE);
    expect(host.textContent).toContain("AI assisted");
    expect(buttons()).toEqual(["Open in Claude Code", "Copy prompt"]);
    expect(host.textContent).not.toContain("terminal");
    expect(host.textContent).not.toContain(AFTERWARDS);
    expect(host.querySelector("pre")?.textContent).toBe(PROMPT);
  });

  it("says where to run the agent when it can't start one", async () => {
    offers({ mode: "none" });
    await render();

    expect(host.querySelector("h3")?.textContent).toBe(TITLE);
    expect(host.textContent).toContain("Run your agent in this app's repo.");
    expect(host.textContent).not.toContain("terminal");
  });

  it("opens the agent dbu6 uses in a terminal on macOS", async () => {
    offers({ mode: "terminal", agent: "codex" });
    await render();

    expect(buttons()).toEqual(["Open in Codex", "Copy prompt"]);
  });

  it("offers a command where no terminal can be opened", async () => {
    offers({ mode: "command", agent: "codex" });
    await render();

    expect(buttons()).toEqual(["Command for Codex", "Copy prompt"]);
  });

  it("offers only Copy prompt when the server hands nothing off, or can't be asked", async () => {
    offers({ mode: "none" });
    await render();
    expect(buttons()).toEqual(["Copy prompt"]);

    availability = { status: 403, body: { error: "Forbidden" } };
    await render();
    expect(buttons()).toEqual(["Copy prompt"]);
  });

  it("asks the server to open the agent, and says where to continue", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render();

    await click("Open in Claude Code");

    expect(posts).toEqual([{ prompt: PROMPT }]);
    expect(host.textContent).toContain(
      "Claude Code is open in a terminal. Continue there.",
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
      "Run this to start Claude Code, then continue there:",
    );
    expect(host.querySelector("code")?.textContent).toBe(`sh '${LAUNCHER}'`);
    expect(buttons()).toContain("Copy");
  });

  it("names the agent the server actually started, not the one the button named", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    handedOffIn("terminal", "codex");
    await render();

    await click("Open in Claude Code");

    expect(host.textContent).toContain("Codex is open in a terminal.");
  });

  it("drops the result, and what to do next, when the prompt changes", async () => {
    offers({ mode: "command", agent: "claude-code" });
    handedOffIn("command");
    await render(PROMPT, AFTERWARDS);
    await click("Command for Claude Code");
    expect(host.querySelector("code")).not.toBeNull();
    expect(host.textContent).toContain(AFTERWARDS);

    await rerender("A different NOPII sample prompt.", AFTERWARDS);

    expect(host.querySelector("code")).toBeNull();
    expect(host.textContent).not.toContain("Run this to start");
    expect(host.textContent).not.toContain(AFTERWARDS);
  });

  it("says what to do next once the agent has the prompt", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render(PROMPT, AFTERWARDS);
    expect(host.textContent).not.toContain(AFTERWARDS);

    await click("Open in Claude Code");

    expect(host.textContent).toContain(AFTERWARDS);
  });

  it("says what to do next after a copy, with no agent to start", async () => {
    offers({ mode: "none" });
    await render(PROMPT, AFTERWARDS);
    expect(host.textContent).not.toContain(AFTERWARDS);

    await click("Copy prompt");

    expect(buttons()).toEqual(["Copied"]);
    expect(host.textContent).toContain(AFTERWARDS);
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
