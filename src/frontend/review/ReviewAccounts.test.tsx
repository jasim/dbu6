// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
import type { PostReadyResult, ReviewAccount } from "../../shared/index";
import { fixReviewPrompt } from "./agentPrompts";
import { ReviewAccounts } from "./ReviewAccounts";

/*
 * Review's list as /add hands over to it (PLAN.md cards 7 and 8): the
 * hand-off note above the list, the first run carried into each account,
 * and its end once nothing is left to post. And its top: what is left
 * across the accounts, Fix these for the agent, and Add all.
 */

const NOTE = "Your transactions are imported.";

let host: HTMLDivElement;
let root: Root;
let accounts: ReviewAccount[];
// The accounts the server says Add all would add; null for every account
// with no block of its own and no other account's drafts to wait on.
let addAllIds: number[] | null;
let addAll: PostReadyResult;
let posts: { url: string; body: unknown }[];
let clipboard: string[];
// While set, the list's reads wait for it.
let listGate: Promise<void> | null;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  accounts = [];
  addAllIds = null;
  posts = [];
  clipboard = [];
  listGate = null;
  addAll = { posted: [], left: [], first_post: false };
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
      const url = request?.url ?? String(input);
      if ((request?.method ?? init?.method) === "POST") {
        const body = request ? await request.text() : String(init?.body);
        posts.push({ url, body: JSON.parse(body) });
        // What Add all left is what the list holds after it.
        const leftIds = addAll.left.map((one) => one.account_id);
        accounts = accounts.filter((one) => leftIds.includes(one.account_id));
        addAllIds = null;
        return Response.json(addAll);
      }
      // No agent the server can start: Fix these copies its prompt.
      if (url.includes("/agent-handoff")) {
        return Response.json({ error: "none" }, { status: 404 });
      }
      if (listGate) await listGate;
      const add_all =
        addAllIds ??
        accounts
          .filter(
            (one) =>
              one.uncategorised + one.duplicates + one.failing_checks === 0 &&
              one.relies_on.length === 0,
          )
          .map((one) => one.account_id);
      return Response.json({ accounts, add_all });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function account(
  id: number,
  name: string,
  overrides: Partial<ReviewAccount> = {},
): ReviewAccount {
  return {
    account_id: id,
    path: name,
    parent_path: null,
    name,
    kind: "bank",
    drafts: 20,
    uncategorised: 5,
    on_own_account: 0,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    relies_on: [],
    draft_span: { first_date: "2026-09-01", last_date: "2026-09-15" },
    rule_requests: 0,
    ...overrides,
  };
}

function Where() {
  const { pathname, search } = useLocation();
  return createElement("code", null, `${pathname}${search}`);
}

async function renderAt(url: string) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: [url] },
          createElement(Where),
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/review",
              element: createElement(ReviewAccounts),
            }),
            createElement(Route, {
              path: "/review/:accountId",
              element: createElement("p", null, "account"),
            }),
          ),
        ),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const text = () => host.textContent ?? "";
const where = () => host.querySelector("code")?.textContent;
const rows = () =>
  Array.from(host.querySelectorAll("li a"), (a) => a.textContent ?? "");
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find((one) =>
    one.textContent?.startsWith(label),
  );
const facts = (heading: string) => {
  const section = Array.from(host.querySelectorAll("div")).find(
    (div) => div.firstElementChild?.textContent === heading,
  );
  return Array.from(section?.querySelectorAll("dl > div") ?? []).map((row) =>
    Array.from(row.children).map((cell) => cell.textContent),
  );
};

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("the account picker after /add", () => {
  it("shows the note above the list, and carries only the first run into an account", async () => {
    accounts = [account(5, "Sample Savings"), account(6, "Sample Card")];
    await renderAt("/review?imported=1&run=setup");

    expect(text()).toContain(NOTE);
    // The note says what to do; the list's own line would repeat it.
    expect(text()).not.toContain("Drafts waiting to go into your books");
    expect(
      Array.from(host.querySelectorAll("li a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/review/5?run=setup", "/review/6?run=setup"]);
  });

  it("opens the only account's Overview with what /add handed over", async () => {
    accounts = [account(5, "Sample Savings")];
    await renderAt("/review?imported=1&run=setup");

    expect(where()).toBe("/review/5?imported=1&run=setup");
  });

  it("opens the only account's Overview outside a hand-off", async () => {
    accounts = [account(5, "Sample Savings")];
    await renderAt("/review");

    expect(where()).toBe("/review/5");
  });

  it("keeps the list's line outside a hand-off", async () => {
    accounts = [account(5, "Sample Savings"), account(6, "Sample Card")];
    await renderAt("/review");

    expect(text()).toContain(
      "Drafts waiting to go into your books, by account.",
    );
    expect(text()).not.toContain(NOTE);
  });

  it("says the books are set up on the first run once nothing is left to post", async () => {
    await renderAt("/review?imported=1&run=setup");

    expect(text()).toContain("Your books are set up.");
    expect(text()).not.toContain(NOTE);
    expect(host.querySelector('a[href="/"]')?.textContent).toBe(
      "See your money",
    );
  });

  it("has nothing to review outside the first run", async () => {
    await renderAt("/review");

    expect(text()).toContain("Nothing to review");
    expect(text()).not.toContain("Your books are set up.");
    // The run on Update is the way on; /import is the by-hand link.
    expect(host.querySelector('a[href="/update"]')?.textContent).toBe(
      "Update your books",
    );
    expect(host.querySelector('a[href="/import"]')?.textContent).toBe(
      "Import by hand",
    );
  });
});

describe("what is left across the accounts", () => {
  // Sample Card goes in with Sample Savings, which is ready: Add all adds
  // both. Sample Loan goes in with Sample Wallet, which needs an account
  // and has rule requests.
  function books() {
    return [
      account(5, "Sample Savings", { uncategorised: 0, drafts: 20 }),
      account(6, "Sample Card", {
        uncategorised: 0,
        on_own_account: 0,
        drafts: 7,
        relies_on: [{ account_id: 5, name: "Sample Savings" }],
      }),
      account(7, "Sample Wallet", { uncategorised: 3, rule_requests: 2 }),
      account(8, "Sample Loan", {
        uncategorised: 0,
        on_own_account: 0,
        relies_on: [{ account_id: 7, name: "Sample Wallet" }],
      }),
    ];
  }

  it("counts what is left, and hands all of it to the agent in one run", async () => {
    accounts = books();
    addAllIds = [5, 6];
    await renderAt("/review");

    // Each row's text ends in its status, before the arrow.
    expect(rows().map((row) => row.replace(/^.*Sep/, ""))).toEqual([
      "Ready to add›",
      "Waits on Sample Savings›",
      "3 need an account›",
      "Waits on Sample Wallet›",
    ]);

    expect(facts("Left to fix")).toEqual([
      ["Need an account", "3"],
      ["Waiting on another account", "1"],
      ["Rule requests", "2"],
    ]);
    await act(async () => button("Fix these")!.click());
    await settle();

    expect(clipboard).toEqual([fixReviewPrompt()]);
  });

  it("presses every account, and says what it added and left", async () => {
    accounts = books();
    addAllIds = [5, 6];
    addAll = {
      posted: [{ account_id: 5, name: "Sample Savings", drafts_posted: 20 }],
      left: [
        {
          account_id: 6,
          name: "Sample Card",
          block: {
            kind: "duplicates",
            state: "blocks",
            severity: "problem",
            count: 1,
          },
        },
        ...books()
          .slice(2)
          .map((one) => ({
            account_id: one.account_id,
            name: one.name,
            block: {
              kind: "categorization" as const,
              state: "blocks" as const,
              severity: "attention" as const,
              count: 3,
              on_own_account: 0,
            },
          })),
      ],
      first_post: false,
    };
    await renderAt("/review");

    const add = button("Add 27 entries from 2 accounts to my books");
    expect(add).toBeDefined();
    await act(async () => add!.click());
    await settle();

    expect(posts).toEqual([
      {
        url: expect.stringContaining("/api/draft-transactions/post-ready"),
        body: { base_account_ids: [5, 6, 7, 8] },
      },
    ]);
    expect(facts("Added to your books")).toEqual([
      ["Sample Savings", "20 entries"],
    ]);
    expect(facts("Left")[0]).toEqual(["Sample Card", "1 possible duplicate"]);
    // The list is read again, and stays though one account is left.
    expect(where()).toBe("/review");
  });

  it("offers no Add all while nothing is ready", async () => {
    accounts = [account(5, "Sample Savings"), account(6, "Sample Card")];
    await renderAt("/review");

    expect(button("Add ")).toBeUndefined();
    expect(button("Fix these")).toBeDefined();
  });

  it("ends the first run when Add all empties books that held nothing before", async () => {
    accounts = [
      account(5, "Sample Savings", { uncategorised: 0 }),
      account(6, "Sample Card", { uncategorised: 0 }),
    ];
    addAll = {
      posted: [
        { account_id: 5, name: "Sample Savings", drafts_posted: 20 },
        { account_id: 6, name: "Sample Card", drafts_posted: 20 },
      ],
      left: [],
      first_post: true,
    };
    await renderAt("/review");

    expect(button("Fix these")).toBeUndefined();
    await act(async () =>
      button("Add 40 entries from 2 accounts to my books")!.click(),
    );
    await settle();

    expect(text()).toContain("Your books are set up.");
  });

  it("keeps the first run in the URL, so the Add all that empties the list later ends it", async () => {
    accounts = [
      account(5, "Sample Savings", { uncategorised: 0 }),
      account(6, "Sample Card", { uncategorised: 0 }),
    ];
    addAll = {
      posted: [{ account_id: 5, name: "Sample Savings", drafts_posted: 20 }],
      left: [
        {
          account_id: 6,
          name: "Sample Card",
          block: {
            kind: "duplicates",
            state: "blocks",
            severity: "problem",
            count: 1,
          },
        },
      ],
      first_post: true,
    };
    await renderAt("/review");
    await act(async () =>
      button("Add 40 entries from 2 accounts to my books")!.click(),
    );
    await settle();
    expect(where()).toBe("/review?run=setup");

    // The agent settled Sample Card; the next post is no longer the first.
    addAll = {
      posted: [{ account_id: 6, name: "Sample Card", drafts_posted: 20 }],
      left: [],
      first_post: false,
    };
    await act(async () =>
      button("Add 20 entries from 1 account to my books")!.click(),
    );
    await settle();

    expect(text()).toContain("Your books are set up.");
  });

  it("keeps Add all busy until the list is read again", async () => {
    accounts = [account(5, "Sample Savings", { uncategorised: 0 })];
    accounts.push(account(6, "Sample Card", { uncategorised: 0 }));
    addAll = {
      posted: [
        { account_id: 5, name: "Sample Savings", drafts_posted: 20 },
        { account_id: 6, name: "Sample Card", drafts_posted: 20 },
      ],
      left: [],
      first_post: false,
    };
    await renderAt("/review");
    let release!: () => void;
    listGate = new Promise((resolve) => (release = resolve));
    await act(async () =>
      button("Add 40 entries from 2 accounts to my books")!.click(),
    );
    await settle();

    // No second Add all from the list as it was before the post.
    expect(button("Adding")?.disabled).toBe(true);
    expect(button("Add 40")).toBeUndefined();

    await act(async () => release());
    await settle();
    expect(button("Add")).toBeUndefined();
    expect(facts("Added to your books")).toHaveLength(2);
  });

  it("counts an account with a failing check under it alone, not as waiting too", async () => {
    accounts = [
      account(5, "Sample Savings", { uncategorised: 3 }),
      account(6, "Sample Card", {
        uncategorised: 0,
        on_own_account: 0,
        failing_checks: 2,
      }),
    ];
    await renderAt("/review");

    expect(facts("Left to fix")).toEqual([
      ["Need an account", "3"],
      ["Failing balance checks", "2"],
    ]);
  });
});
