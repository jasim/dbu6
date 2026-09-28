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
  CategorizationRuleRequest,
  ReviewAccountDetail,
} from "../../shared/index";
import { ImproveCategorizationTab } from "./ImproveCategorizationTab";
import type { ReviewAccountContext } from "./ReviewAccount";

/*
 * Improve categorization's two-region left column. The rule request being
 * made comes first: it says what to select, or that every draft goes to an
 * account. The rules it makes come under their own heading, "Rules to add",
 * which names and counts them, above the one button that hands them to the
 * coding agent and then goes to Run categorizer. The grid needs the table's
 * schema, which no test here loads, so a rule request is never being made in
 * these tests: the compose card itself is checked in the preview harness.
 */

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ method: string; url: URL }>;
let ruleRequests: CategorizationRuleRequest[];

const RULE_REQUESTS: CategorizationRuleRequest[] = [
  {
    id: 11,
    base_account_id: 5,
    account: { id: 7, name: "Groceries" },
    transactions: [
      {
        date: "2026-09-01",
        source_narration: "NOPII SHOP ONE",
        direction: "withdrawal",
        amount: 120,
      },
      {
        date: "2026-09-03",
        source_narration: "NOPII SHOP ONE AGAIN",
        direction: "withdrawal",
        amount: 450.5,
      },
    ],
    note: "A sample grocery shop",
  },
  {
    id: 12,
    base_account_id: 5,
    account: { id: 8, name: "Dining" },
    transactions: [
      {
        date: "2026-09-02",
        source_narration: "NOPII CAFE",
        direction: "withdrawal",
        amount: 300,
      },
    ],
    note: "",
  },
];

function respond(method: string, url: URL): unknown {
  if (url.pathname.endsWith("/categorization-rule-requests")) {
    if (method === "DELETE") {
      const deleted = ruleRequests.length;
      ruleRequests = [];
      return { deleted };
    }
    return { rule_requests: ruleRequests };
  }
  const one = /\/categorization-rule-requests\/(\d+)$/.exec(url.pathname);
  if (method === "DELETE" && one) {
    ruleRequests = ruleRequests.filter(
      (ruleRequest) => ruleRequest.id !== Number(one[1]),
    );
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
  ruleRequests = RULE_REQUESTS;
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
    imported: null,
    notice: false,
    closeNotice: () => {},
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
// The region the "Rules to add" heading names: it holds the rules and the one
// action on them, never the rule request being made.
const region = () =>
  host.querySelector("#rules-to-add-heading")?.closest("section") ?? null;
// Each rule as its labelled facts (account, drafts) and its description chips.
const rules = () =>
  [...host.querySelectorAll("aside ol > li")].map((li) => {
    const fact = (label: string) =>
      [...li.querySelectorAll("dl > div")]
        .find((row) => row.querySelector("dt")?.textContent === label)
        ?.querySelector("dd")?.textContent;
    return {
      account: fact("Account"),
      drafts: fact("Drafts"),
      descriptions: [...li.querySelectorAll("ul > li")].map(
        (chip) => chip.textContent,
      ),
    };
  });
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.startsWith(label) ||
      b.getAttribute("aria-label") === label,
  );

describe("Improve categorization", () => {
  it("says what to select, and lists the rules to add with their account and drafts", async () => {
    await render();

    expect(panel()).toContain("Select drafts to categorize");
    expect(panel()).toContain("Choose the account they should go to");
    expect(rules()).toEqual([
      {
        account: "Groceries",
        drafts: "2",
        descriptions: ["NOPII SHOP ONE", "NOPII SHOP ONE AGAIN"],
      },
      {
        account: "Dining",
        drafts: "1",
        descriptions: ["NOPII CAFE"],
      },
    ]);
    expect(panel()).toContain("A sample grocery shop");
    expect(button("Turn 2 rule requests into rules")).toBeDefined();
    expect(
      requests
        .find((r) => r.url.pathname.endsWith("/categorization-rule-requests"))
        ?.url.searchParams.get("base_account_id"),
    ).toBe("5");
    expect(
      host
        .querySelector('aside a[href^="/categorization-rules"]')
        ?.getAttribute("href"),
    ).toBe("/categorization-rules?show=ai&account=5");
  });

  it("heads the rules to add with their own heading, apart from the rule request being made", async () => {
    await render();

    // The heading names and counts the list under it, so "Turn 2 rule
    // requests into rules" is visibly about these and not about the rule
    // request being made at the top of the column.
    expect(region()?.textContent).toContain("Rules to add");
    expect(region()?.querySelectorAll("ol > li")).toHaveLength(2);
    expect(region()?.textContent).not.toContain("Select drafts to categorize");
    expect(host.querySelector("aside")?.getAttribute("aria-label")).toBe(
      "Improve categorization",
    );
  });

  it("says the rules aren't added yet, over the action that adds them", async () => {
    await render();

    // The column's last step is the one that finishes the job, and the line
    // over it says what state the rules are in until it runs.
    const state = [...(region()?.querySelectorAll("p") ?? [])].find(
      (p) => p.textContent === "Not added yet",
    );
    expect(state).toBeDefined();
    const add = button("Turn 2 rule requests into rules");
    expect(
      state!.compareDocumentPosition(add!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("removes a rule request, and offers nothing to add once none is left", async () => {
    await render();

    await act(async () =>
      button("Remove the rule request for Dining")?.click(),
    );
    await settle();
    expect(rules().map((rule) => rule.account)).toEqual(["Groceries"]);
    expect(button("Turn 1 rule request into rules")).toBeDefined();

    await act(async () =>
      button("Remove the rule request for Groceries")?.click(),
    );
    await settle();
    expect(rules()).toEqual([]);
    expect(button("Turn")).toBeUndefined();
  });

  it("hands the rule requests to the agent, then goes to Run categorizer", async () => {
    await render();

    await act(async () => button("Turn 2 rule requests into rules")?.click());
    await settle();

    const handoff = requests.find(
      (r) => r.method === "POST" && r.url.pathname.endsWith("/agent-handoff"),
    );
    expect(handoff).toBeDefined();
    expect(host.textContent).toBe("run categorizer");
  });

  it("says so, in place of the rules and the list, when every draft goes to an account", async () => {
    ruleRequests = [];
    await render(0);

    expect(host.textContent).toContain("Every draft goes to an account");
    expect(host.querySelector("aside")).toBeNull();
    expect(host.textContent).not.toContain("Couldn't categorize");
  });
});
