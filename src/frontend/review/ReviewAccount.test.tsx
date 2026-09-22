// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
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
import type {
  SchemaTableRowsByLevel,
  TableGridActionsProps,
} from "@sapporta/frontend";
import { DraftsActions } from "./DraftsTab";
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
      name: "Sample Savings",
      kind: "bank",
      drafts: 23,
      uncategorised: 3,
      duplicates: 0,
      balance_checks: 13,
      failing_checks: 0,
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-15" },
      ...account,
    },
    checkpoint: { date: "2026-08-31", balance: 50505 },
    has_opening_entry: true,
    closing: { date: "2026-09-15", balance: 50505 },
    failing: [],
    duplicates: [],
    other_accounts: [],
  } satisfies ReviewAccountDetail;
}

function Tab({ name }: { name: string }) {
  const { detail } = useReviewAccount();
  return createElement(
    "output",
    { "data-tab": name },
    `${name}: ${detail.account.uncategorised} uncategorised`,
  );
}

function Where() {
  return createElement("code", null, useLocation().pathname);
}

async function renderAt(
  url: string,
  draftsTab: ReactElement = createElement(Tab, { name: "drafts" }),
) {
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
                element: createElement(Tab, { name: "overview" }),
              }),
              createElement(Route, {
                path: "drafts",
                element: draftsTab,
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

  it("runs the categoriser again on this account's drafts, from the Drafts toolbar", async () => {
    responses = [{ status: 200, body: detail() }];
    // The grid hands its toolbar actions a live session; these ones read
    // only the surface they are on.
    const toolbar = {
      surface: "toolbar",
    } as TableGridActionsProps<SchemaTableRowsByLevel>;
    await renderAt(
      "/review/5/drafts",
      createElement(DraftsActions, toolbar),
    );

    const again = Array.from(host.querySelectorAll("a")).find(
      (a) => a.textContent === "Run the categoriser again",
    );
    expect(again?.getAttribute("href")).toBe(
      "/views/reclassify-drafts?account=5",
    );
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
