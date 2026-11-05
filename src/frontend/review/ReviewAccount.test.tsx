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
import type { ReviewAccountDetail } from "../../shared/index";
import { Overview } from "./Overview";
import { ReviewAccount, useReviewAccount } from "./ReviewAccount";

/*
 * The account frame's own behaviour (PLAN.md §11 P3): the summary is read
 * again on every tab change, so an edit made in one tab shows in the counts
 * on the next; and a path under the account that isn't a tab lands on its
 * Overview, whether or not the account has drafts.
 */

let host: HTMLDivElement;
let root: Root;
let responses: Array<{ status: number; body: unknown }>;
let requests: string[];

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
  responses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input instanceof Request ? input.url : input));
      const next = responses.length > 1 ? responses.shift()! : responses[0]!;
      return Response.json(next.body, { status: next.status });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function detail(account: Partial<ReviewAccountDetail["account"]> = {}) {
  return {
    account: {
      account_id: 5,
      path: "Sample Savings",
      parent_path: null,
      name: "Sample Savings",
      kind: "bank",
      drafts: 23,
      uncategorised: 3,
      on_own_account: 0,
      duplicates: 0,
      balance_checks: 13,
      failing_checks: 0,
      relies_on: [],
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-15" },
      rule_requests: 0,
      ...account,
    },
    checkpoint: { date: "2026-08-31", balance: 50505 },
    has_opening_entry: true,
    no_starting_balance: [],
    closing: { date: "2026-09-15", balance: 50505 },
    failing: [],
    duplicates: [],
    other_accounts: [],
  } satisfies ReviewAccountDetail;
}

function Tab({ name }: { name: string }) {
  const { detail, imported, notice } = useReviewAccount();
  return createElement(
    "output",
    { "data-tab": name },
    `${name}: ${detail.account.uncategorised} uncategorised`,
    imported &&
      ` · imported ${imported.categorized} of ${imported.drafts}${notice ? " · notice" : ""}`,
  );
}

function Where() {
  return createElement("code", null, useLocation().pathname);
}

async function renderAt(url: string, overview = false) {
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
              element: createElement("p", null, "picker"),
            }),
            createElement(
              Route,
              {
                path: "/review/:accountId",
                element: createElement(ReviewAccount),
              },
              createElement(Route, {
                index: true,
                element: overview
                  ? createElement(Overview)
                  : createElement(Tab, { name: "overview" }),
              }),
              createElement(Route, {
                path: "drafts",
                element: createElement(Tab, { name: "drafts" }),
              }),
              createElement(Route, { path: "*", element: null }),
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

const text = () => host.textContent ?? "";
const pathname = () => host.querySelector("code")?.textContent;

describe("the review account frame", () => {
  it("reads the summary again when the tab changes", async () => {
    responses = [
      { status: 200, body: detail({ uncategorised: 3 }) },
      { status: 200, body: detail({ uncategorised: 2 }) },
    ];
    await renderAt("/review/5");

    expect(text()).toContain("overview: 3 uncategorised");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/review/accounts/5");

    const drafts = Array.from(host.querySelectorAll("a")).find((a) =>
      a.textContent?.startsWith("Drafts"),
    );
    expect(drafts?.textContent).toBe("Drafts23");
    await act(async () => drafts!.click());
    await settle();

    expect(pathname()).toBe("/review/5/drafts");
    expect(requests).toHaveLength(2);
    expect(text()).toContain("drafts: 2 uncategorised");
    expect(host.querySelector('a[aria-current="page"]')?.textContent).toBe(
      "Drafts23",
    );
  });

  it("offers Improve categorization and Run categorizer after Drafts", async () => {
    responses = [{ status: 200, body: detail() }];
    await renderAt("/review/5");

    const tabs = Array.from(host.querySelectorAll("nav a")).map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(tabs.slice(0, 4)).toEqual([
      ["Overview", "/review/5"],
      ["Drafts23", "/review/5/drafts"],
      ["Improve categorization", "/review/5/improve-categorization"],
      ["Run categorizer", "/review/5/run-categorizer"],
    ]);
  });

  // The tabs are how a check is fixed, so the open one reads as a pressed
  // control on a band of its own, not as a line of text beside the account
  // name.
  it("sets the open tab on a fill and the closed ones off it", async () => {
    responses = [{ status: 200, body: detail() }];
    await renderAt("/review/5");

    const tabs = Array.from(host.querySelectorAll("nav a"));
    const open = tabs.filter((a) => a.getAttribute("aria-current") === "page");
    const closed = tabs.filter(
      (a) => a.getAttribute("aria-current") !== "page",
    );
    expect(open.map((a) => a.textContent)).toEqual(["Overview"]);
    expect(open[0]?.className).toContain("bg-muted");
    expect(closed[0]?.className).toContain("hover:bg-muted");
    // The band above carries the account name alone: nothing in it is a tab.
    expect(host.querySelector("header > div a[href^='/review/5']")).toBeNull();
  });

  it("sends a path that isn't a tab to Overview, for an account with no drafts too", async () => {
    responses = [
      { status: 200, body: detail({ drafts: 0, uncategorised: 0 }) },
    ];
    await renderAt("/review/5/nowhere");

    expect(pathname()).toBe("/review/5");
    expect(text()).toContain("No drafts for Sample Savings");
    expect(host.querySelector("nav")).toBeNull();
  });

  it("sends an id that isn't one to the picker, without asking the server", async () => {
    await renderAt("/review/sample");

    expect(pathname()).toBe("/review");
    expect(text()).toContain("picker");
    expect(requests).toHaveLength(0);
  });

  it("says so when the account isn't found", async () => {
    responses = [{ status: 404, body: { error: "Account not found" } }];
    await renderAt("/review/5");

    expect(text()).toContain("We couldn't find this account.");
  });
});

describe("what /add hands the account's review", () => {
  const NOTE =
    "Your transactions are imported. Categorize them, then post them to your books.";

  it("hands the Overview what the add imported, read once", async () => {
    responses = [{ status: 200, body: detail() }];
    await renderAt("/review/5?imported=1&drafts=23&categorized=20");

    expect(text()).toContain(
      "overview: 3 uncategorised · imported 20 of 23 · notice",
    );
    const drafts = Array.from(host.querySelectorAll("nav a")).find((a) =>
      a.textContent?.startsWith("Drafts"),
    );
    // The tabs don't carry it.
    expect(drafts?.getAttribute("href")).toBe("/review/5/drafts");
  });

  it("has nothing to tell of a visit no add opened", async () => {
    responses = [{ status: 200, body: detail() }];
    await renderAt("/review/5");

    expect(text()).toContain("overview: 3 uncategorised");
    expect(text()).not.toContain("imported");
  });

  it("carries the first run on its tabs and the way back", async () => {
    responses = [
      {
        status: 200,
        body: {
          ...detail(),
          other_accounts: [{ account_id: 6, name: "Sample Card", drafts: 4 }],
        },
      },
    ];
    await renderAt("/review/5?run=setup");

    const hrefs = Array.from(host.querySelectorAll("header a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs.slice(0, 3)).toEqual([
      "/review?run=setup",
      "/review/5?run=setup",
      "/review/5/drafts?run=setup",
    ]);
    expect(text()).not.toContain(NOTE);
  });

  it("says the books are set up on the first run once nothing is left to post", async () => {
    responses = [
      { status: 200, body: detail({ drafts: 0, uncategorised: 0 }) },
    ];
    await renderAt("/review/5?run=setup&imported=1");

    expect(text()).toContain("Your books are set up.");
    expect(text()).not.toContain(NOTE);
    expect(text()).not.toContain("No drafts for");
  });

  it("keeps the account's own empty state while another account has drafts", async () => {
    responses = [
      {
        status: 200,
        body: {
          ...detail({ drafts: 0, uncategorised: 0 }),
          other_accounts: [{ account_id: 6, name: "Sample Card", drafts: 4 }],
        },
      },
    ];
    await renderAt("/review/5?run=setup");

    expect(text()).toContain("No drafts for Sample Savings");
    expect(text()).not.toContain("Your books are set up.");
  });
});

describe("an account's Overview", () => {
  // The account's summary on GET, the post's answer on POST; no agent the
  // server can start.
  function serve(post: Record<string, unknown>, others: unknown[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        requests.push(url);
        if ((request?.method ?? init?.method) === "POST") {
          return Response.json(post);
        }
        if (url.includes("/agent-handoff")) {
          return Response.json({ error: "none" }, { status: 404 });
        }
        if (url.endsWith("/review/accounts")) {
          return Response.json({ accounts: [] });
        }
        return Response.json({
          ...detail({ uncategorised: 0 }),
          other_accounts: others,
        });
      }),
    );
  }
  const posted = (first_post: boolean) => ({
    base_account: "Sample Savings",
    journals_created: 23,
    entries_created: 46,
    drafts_posted: 23,
    first_post,
  });
  const button = (label: string) =>
    Array.from(host.querySelectorAll("button")).find((one) =>
      one.textContent?.startsWith(label),
    );

  it("offers Fix these while something blocks the add", async () => {
    responses = [{ status: 200, body: detail({ uncategorised: 3 }) }];
    await renderAt("/review/5", true);

    expect(button("Fix these")).toBeDefined();
  });

  it("says the books are set up when the first post leaves nothing to review", async () => {
    serve(posted(true));
    await renderAt("/review/5", true);

    expect(button("Fix these")).toBeUndefined();
    await act(async () => button("Add to my books")!.click());
    await settle();

    expect(text()).toContain("Your books are set up.");
  });

  const others = [{ account_id: 6, name: "Sample Card", drafts: 4 }];

  it("carries a first post on to the next account", async () => {
    serve(posted(true), others);
    await renderAt("/review/5", true);
    await act(async () => button("Add to my books")!.click());
    await settle();

    expect(
      host.querySelector('a[href="/review/6?run=setup"]')?.textContent,
    ).toBe("Review Sample Card");
  });

  it("doesn't carry a later post", async () => {
    serve(posted(false), others);
    await renderAt("/review/5", true);
    await act(async () => button("Add to my books")!.click());
    await settle();

    expect(host.querySelector('a[href="/review/6"]')?.textContent).toBe(
      "Review Sample Card",
    );
    expect(text()).not.toContain("Your books are set up.");
  });
});
