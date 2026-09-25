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
import type { ReviewAccount } from "../../shared/index";
import { ReviewAccounts } from "./ReviewAccounts";

/*
 * The account picker as /add hands over to it (PLAN.md cards 7 and 8): the
 * hand-off note above the list, the first run carried into each account,
 * and its end once nothing is left to post.
 */

const NOTE =
  "Your transactions are imported. Categorize them, then post them to your books.";

let host: HTMLDivElement;
let root: Root;
let accounts: ReviewAccount[];

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ accounts })),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function account(id: number, name: string): ReviewAccount {
  return {
    account_id: id,
    path: name,
    name,
    kind: "bank",
    drafts: 20,
    uncategorised: 5,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    draft_span: { first_date: "2026-09-01", last_date: "2026-09-15" },
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

describe("the account picker after /add", () => {
  it("shows the note above the list, and carries only the first run into an account", async () => {
    accounts = [account(5, "Sample Savings"), account(6, "Sample Card")];
    await renderAt("/review?imported=1&run=setup");

    expect(text()).toContain(NOTE);
    // The note says what to do; the picker's own line would repeat it.
    expect(text()).not.toContain("Pick an account");
    expect(
      Array.from(host.querySelectorAll("li a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/review/5?run=setup", "/review/6?run=setup"]);
  });

  it("opens the only account's drafts with what /add handed over", async () => {
    accounts = [account(5, "Sample Savings")];
    await renderAt("/review?imported=1&run=setup");

    expect(where()).toBe("/review/5/drafts?imported=1&run=setup");
  });

  it("opens the only account's Overview outside a hand-off", async () => {
    accounts = [account(5, "Sample Savings")];
    await renderAt("/review");

    expect(where()).toBe("/review/5");
  });

  it("keeps the picker's line outside a hand-off", async () => {
    accounts = [account(5, "Sample Savings"), account(6, "Sample Card")];
    await renderAt("/review");

    expect(text()).toContain("Pick an account");
    expect(text()).not.toContain(NOTE);
  });

  it("says the books are set up on the first run once nothing is left to post", async () => {
    await renderAt("/review?imported=1&run=setup");

    expect(text()).toContain("Your books are set up.");
    expect(text()).not.toContain(NOTE);
    expect(host.querySelector('a[href="/"]')?.textContent).toBe("Go to Home");
  });

  it("has nothing to review outside the first run", async () => {
    await renderAt("/review");

    expect(text()).toContain("Nothing to review");
    expect(text()).not.toContain("Your books are set up.");
  });
});
