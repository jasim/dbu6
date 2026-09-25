// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
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
import type {
  CategorizationLesson,
  ReviewAccountDetail,
} from "../../shared/index";
import { ImproveCategorizationTab } from "./ImproveCategorizationTab";
import type { ReviewAccountContext } from "./ReviewAccount";

/*
 * Improve categorization's New rules column: it says what to select, or that
 * every draft has a category; the new rules made here wait under it, account
 * first, each with a way to remove it, above the button that hands them to
 * the coding agent and then goes to Run categorizer. The grid needs the
 * table's schema, which no test here loads.
 */

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ method: string; url: URL }>;
let lessons: CategorizationLesson[];

const LESSONS: CategorizationLesson[] = [
  {
    id: 11,
    base_account_id: 5,
    account: { id: 7, name: "Groceries" },
    narrations: ["NOPII SHOP ONE", "NOPII SHOP ONE AGAIN"],
    note: "A sample grocery shop",
  },
  {
    id: 12,
    base_account_id: 5,
    account: { id: 8, name: "Dining" },
    narrations: ["NOPII CAFE"],
    note: "",
  },
];

function respond(method: string, url: URL): unknown {
  if (url.pathname.endsWith("/categorization-lessons")) {
    if (method === "DELETE") {
      const deleted = lessons.length;
      lessons = [];
      return { deleted };
    }
    return { lessons };
  }
  const one = /\/categorization-lessons\/(\d+)$/.exec(url.pathname);
  if (method === "DELETE" && one) {
    lessons = lessons.filter((lesson) => lesson.id !== Number(one[1]));
    return { deleted: 1 };
  }
  if (url.pathname.endsWith("/agent-handoff")) {
    return method === "POST"
      ? {
          mode: "terminal",
          agent: "claude-code",
          prompt_path: "tmp/agent-prompts/sample.md",
          launcher_path: "tmp/agent-prompts/sample.sh",
          command: "sh 'tmp/agent-prompts/sample.sh'",
        }
      : { mode: "terminal", agent: "claude-code" };
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  requests = [];
  lessons = LESSONS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const url = new URL(
        String(request ? request.url : input),
        "http://localhost",
      );
      requests.push({ method, url });
      return Response.json(respond(method, url));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function detail(uncategorised: number): ReviewAccountDetail {
  return {
    account: {
      account_id: 5,
      path: "Sample Savings",
      name: "Sample Savings",
      kind: "bank",
      drafts: 4,
      uncategorised,
      duplicates: 0,
      balance_checks: 0,
      failing_checks: 0,
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-01" },
    },
    checkpoint: null,
    has_opening_entry: true,
    closing: null,
    failing: [],
    duplicates: [],
    other_accounts: [],
  };
}

async function render(uncategorised = 4) {
  const context: ReviewAccountContext = {
    detail: detail(uncategorised),
    refresh: () => {},
    posted: null,
    setPosted: () => {},
    setup: false,
  };
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: ["/review/5/improve-categorization"] },
          createElement(
            Routes,
            null,
            createElement(
              Route,
              {
                path: "/review/:accountId",
                element: createElement(Outlet, { context }),
              },
              createElement(Route, {
                path: "improve-categorization",
                element: createElement(ImproveCategorizationTab),
              }),
              createElement(Route, {
                path: "run-categorizer",
                element: createElement("p", null, "run categorizer"),
              }),
            ),
          ),
        ),
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

const panel = () => host.querySelector("aside")?.textContent ?? "";
const rules = () =>
  [...host.querySelectorAll("aside ol > li")].map((li) => ({
    account: li.querySelector("p")?.textContent,
    descriptions: [...li.querySelectorAll("ul > li")].map(
      (chip) => chip.textContent,
    ),
  }));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.startsWith(label) ||
      b.getAttribute("aria-label") === label,
  );

describe("Improve categorization", () => {
  it("says what to select, and lists the new rules account first", async () => {
    await render();

    expect(panel()).toContain("Select drafts to make a rule");
    expect(rules()).toEqual([
      {
        account: "Groceries",
        descriptions: ["NOPII SHOP ONE", "NOPII SHOP ONE AGAIN"],
      },
      { account: "Dining", descriptions: ["NOPII CAFE"] },
    ]);
    expect(panel()).toContain("A sample grocery shop");
    expect(button("Add 2 to categorization rules")).toBeDefined();
    expect(
      requests
        .find((r) => r.url.pathname.endsWith("/categorization-lessons"))
        ?.url.searchParams.get("base_account_id"),
    ).toBe("5");
    expect(
      host
        .querySelector('aside a[href^="/categorization-rules"]')
        ?.getAttribute("href"),
    ).toBe("/categorization-rules?show=ai&account=5");
  });

  it("removes a rule, and offers nothing to add once none is left", async () => {
    await render();

    await act(async () => button("Remove the rule for Dining")?.click());
    await settle();
    expect(rules().map((rule) => rule.account)).toEqual(["Groceries"]);
    expect(button("Add 1 to categorization rules")).toBeDefined();

    await act(async () => button("Remove the rule for Groceries")?.click());
    await settle();
    expect(rules()).toEqual([]);
    expect(button("Add")).toBeUndefined();
  });

  it("hands the new rules to the agent, then goes to Run categorizer", async () => {
    await render();

    await act(async () => button("Add 2 to categorization rules")?.click());
    await settle();

    const handoff = requests.find(
      (r) => r.method === "POST" && r.url.pathname.endsWith("/agent-handoff"),
    );
    expect(handoff).toBeDefined();
    expect(host.textContent).toBe("run categorizer");
  });

  it("says so when every draft has a category", async () => {
    lessons = [];
    await render(0);

    expect(panel()).toContain("Every draft has a category");
    expect(panel()).not.toContain("Select drafts");
  });
});
