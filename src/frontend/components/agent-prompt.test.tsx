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
import type { AgentHandoffAvailability } from "../../shared/index";
import {
  agentPrompt,
  PLAN_FIRST_RULE,
  type AgentPrompt,
} from "../agent-prompt-rules";
import { AgentButton } from "./agent-prompt";

/*
 * One button, named for the task, hands the prompt to the agent the server
 * can start, or copies it where none can be; its arrow holds the other ways.
 * A click shows what happened in the button's place. What the user does next
 * waits until they have taken the prompt somewhere. Whichever way the prompt
 * goes, it goes as agentPrompt wrote it, plan-first rule and all.
 */

let host: HTMLDivElement;
let root: Root;
let availability: { status: number; body: unknown };
let handoff: { status: number; body: unknown };
let posts: unknown[];
let clipboard: string[];

const PROMPT = sample("Build a parser for NOPII sample statement 050505.");

function sample(outcome: string): AgentPrompt {
  return agentPrompt({
    outcome,
    facts: "File: tmp/sample-050505.pdf",
    report: [{ heading: "Result", says: "whether it reads." }],
  });
}
const LABEL = "Set up this format";
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
  clipboard = [];
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
    value: {
      writeText: async (text: string) => {
        clipboard.push(text);
      },
    },
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

type Props = Partial<Parameters<typeof AgentButton>[0]>;

async function render(prompt = PROMPT, afterwards?: string, props: Props = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await rerender(prompt, afterwards, props);
}

async function rerender(
  prompt: AgentPrompt,
  afterwards?: string,
  props: Props = {},
) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AgentButton, {
          label: LABEL,
          prompt,
          afterwards,
          ...props,
        }),
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

/** The buttons, by what a screen reader hears. */
function buttons(): string[] {
  return [...host.querySelectorAll("button")].map(
    (b) => b.getAttribute("aria-label") ?? b.textContent ?? "",
  );
}

async function press(element: Element | undefined, what: string) {
  if (!(element instanceof HTMLElement)) throw new Error(`No ${what}`);
  await act(async () => {
    element.click();
  });
  await settle();
}

async function click(label: string) {
  await press(
    [...host.querySelectorAll("button")].find((b) => b.textContent === label),
    `button ${label}`,
  );
}

const MORE = "More ways to give this to your agent";

/** The arrow's menu, opened: its items, which render outside the host. */
async function openMenu(): Promise<string[]> {
  await press(
    host.querySelector(`[aria-label="${MORE}"]`) ?? undefined,
    "arrow",
  );
  return [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
}

async function choose(item: string) {
  await press(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (i) => i.textContent === item,
    ),
    `menu item ${item}`,
  );
}

describe("AgentButton", () => {
  it("names the task, and says where it opens only to a screen reader", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render(PROMPT, AFTERWARDS);

    expect(buttons()).toEqual([`${LABEL}. Open in Claude Code`, MORE]);
    expect(host.textContent).not.toContain(AFTERWARDS);
    expect(host.querySelector("pre")).toBeNull();
  });

  it("keeps the other ways in its arrow", async () => {
    offers({ mode: "terminal", agent: "codex" });
    await render();

    expect(await openMenu()).toEqual([
      "Open in Codex",
      "Copy prompt",
      "View prompt",
    ]);
  });

  it("hands over the prompt as agentPrompt wrote it, plan-first rule included, however it goes", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render();

    await openMenu();
    await choose("Copy prompt");
    await openMenu();
    await choose("Open in Claude Code");

    expect(clipboard).toEqual([PROMPT]);
    expect(posts).toEqual([{ prompt: PROMPT }]);
    expect(PROMPT).toContain(PLAN_FIRST_RULE);
  });

  it("shows the whole prompt on View prompt, in one block", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render();

    await openMenu();
    await choose("View prompt");

    const shown = [...document.querySelectorAll("pre")].map(
      (p) => p.textContent,
    );
    expect(shown).toEqual([PROMPT]);
  });

  it("copies the prompt where the server hands nothing off, or can't be asked", async () => {
    offers({ mode: "none" });
    await render();
    expect(buttons()).toEqual([`${LABEL}. Copies the prompt`, MORE]);
    expect(await openMenu()).toEqual(["Copy prompt", "View prompt"]);

    availability = { status: 403, body: { error: "Forbidden" } };
    await render();
    expect(buttons()[0]).toBe(`${LABEL}. Copies the prompt`);
  });

  it("says what to do next after a copy, with no agent to start", async () => {
    offers({ mode: "none" });
    await render(PROMPT, AFTERWARDS);
    expect(host.textContent).not.toContain(AFTERWARDS);

    await click(`${LABEL}. Copies the prompt`);

    expect(clipboard).toEqual([PROMPT]);
    expect(buttons()[0]).toBe("Copied. Copies the prompt");
    expect(host.textContent).toContain(AFTERWARDS);
  });

  it("gives its place to where the agent is, with a retry and the command for when it didn't open", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render(PROMPT, AFTERWARDS);

    await click(`${LABEL}. Open in Claude Code`);

    expect(posts).toEqual([{ prompt: PROMPT }]);
    expect(host.textContent).toContain(
      "Opened in Claude Code — continue in your terminal",
    );
    expect(host.textContent).toContain(AFTERWARDS);
    expect(host.querySelector("code")).toBeNull();

    await click("Didn't open? Try again");

    expect(posts).toEqual([{ prompt: PROMPT }, { prompt: PROMPT }]);
    expect(host.querySelector("code")?.textContent).toBe(`sh '${LAUNCHER}'`);
  });

  it("shows the command to run where no terminal can be opened", async () => {
    offers({ mode: "command", agent: "claude-code" });
    handedOffIn("command");
    await render();
    expect(buttons()[0]).toBe(`${LABEL}. Command for Claude Code`);

    await click(`${LABEL}. Command for Claude Code`);

    expect(host.textContent).toContain(
      "Run this to start Claude Code. It shows its plan first.",
    );
    expect(host.querySelector("code")?.textContent).toBe(`sh '${LAUNCHER}'`);
    expect(buttons()).toContain("Copy");
  });

  it("names the agent the server actually started, not the one the button named", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    handedOffIn("terminal", "codex");
    await render();

    await click(`${LABEL}. Open in Claude Code`);

    expect(host.textContent).toContain("Opened in Codex");
  });

  it("drops the result, and what to do next, when the prompt changes", async () => {
    offers({ mode: "command", agent: "claude-code" });
    handedOffIn("command");
    await render(PROMPT, AFTERWARDS);
    await click(`${LABEL}. Command for Claude Code`);
    expect(host.querySelector("code")).not.toBeNull();
    expect(host.textContent).toContain(AFTERWARDS);

    await rerender(sample("A different NOPII sample prompt."), AFTERWARDS);

    expect(host.querySelector("code")).toBeNull();
    expect(host.textContent).not.toContain(AFTERWARDS);
    expect(buttons()[0]).toBe(`${LABEL}. Command for Claude Code`);
  });

  it("is an outline beside a screen's primary, and can take a region's width", async () => {
    offers({ mode: "terminal", agent: "claude-code" });
    await render(PROMPT, undefined, { primary: false, wide: true });

    const button = host.querySelector("button");
    expect(button?.className).toContain("border-sap-border-strong");
    expect(button?.parentElement?.className).toContain("w-full");
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

    await click(`${LABEL}. Open in Claude Code`);

    expect(host.textContent).toContain(
      "Couldn't open a terminal window (sample failure).",
    );
    expect(buttons()[0]).toBe(`${LABEL}. Open in Claude Code`);
  });
});
