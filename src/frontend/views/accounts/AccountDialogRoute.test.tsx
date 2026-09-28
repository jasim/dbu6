// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
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
import { EditAccountDialog, NewAccountDialog } from "./AccountDialogRoute";
import { editAccountHref, NEW_ACCOUNT_ROUTE } from "./routes";
import type { AccountRow } from "./account-form";

/*
 * The Accounts page's forms as URLs: /accounts/new and
 * /accounts/:accountId/edit each open the form on their own, from a pasted
 * link as much as from a click; closing returns to the chart the form was
 * opened from, query string and all; and an id that names no account says so
 * instead of opening an empty form.
 *
 * Assets (1) > Bank Accounts (2) > Sample Savings (3). Sample Savings is a
 * bank's account, which is why its type follows its statements.
 */

const CHART: AccountRow[] = [
  { id: 1, name: "Assets", parent_id: null, account_type: "Asset" },
  { id: 2, name: "Bank Accounts", parent_id: 1, account_type: "Asset" },
  { id: 3, name: "Sample Savings", parent_id: 2, account_type: "Asset" },
];

let host: HTMLDivElement;
let root: Root;
let sent: { method: string; path: string; body: unknown }[];
let asks: string[];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function rowsResponse(data: unknown[]): Response {
  return Response.json({
    data,
    meta: { total: data.length, page: 1, limit: 1000, pages: 1 },
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  sent = [];
  asks = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(String(request?.url ?? input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      const body = request
        ? await request.text()
        : typeof init?.body === "string"
          ? init.body
          : null;
      asks.push(`${method} ${url.pathname}`);

      const one = /\/tables\/accounts\/(\d+)$/.exec(url.pathname);
      if (method === "GET" && one) {
        const row = CHART.find((account) => account.id === Number(one[1]));
        return row === undefined
          ? Response.json({ error: "No such row" }, { status: 404 })
          : Response.json({ data: row });
      }
      if (method === "GET" && url.pathname.endsWith("/tables/accounts")) {
        return rowsResponse(CHART);
      }
      if (method === "GET" && url.pathname.endsWith("/import-presets")) {
        return Response.json({
          institutions: [
            {
              id: 1,
              name: "Sample Bank",
              parsers: [],
              accounts: [
                {
                  account_id: 3,
                  name: "Sample Savings",
                  is_credit_card: false,
                  account_identifiers: [],
                  custom_mappings_filenames: [],
                  ledger_account_name: "Sample Savings",
                },
              ],
            },
          ],
        });
      }
      if (method === "GET" && url.pathname.endsWith("/journal_entries")) {
        return rowsResponse([]);
      }
      if (method === "POST" && url.pathname.endsWith("/tables/accounts")) {
        sent.push({
          method,
          path: url.pathname,
          body: body === null ? null : JSON.parse(body),
        });
        return rowsResponse([]);
      }
      if (method === "PUT" && /\/accounts\/\d+$/.test(url.pathname)) {
        sent.push({
          method,
          path: url.pathname,
          body: body === null ? null : JSON.parse(body),
        });
        return Response.json({ account: CHART[2], moved: 0 });
      }
      return Response.json({ error: "Not here" }, { status: 404 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Lets the stubbed fetches answer and the screen catch up. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * The chart's route with the two form routes under it, exactly as the app
 * mounts them, at `entry`.
 */
async function render(entry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "accounts",
        element: createElement(Outlet),
        children: [
          { path: "new", element: createElement(NewAccountDialog) },
          {
            path: ":accountId/edit",
            element: createElement(EditAccountDialog),
          },
        ],
      },
    ],
    { initialEntries: [entry] },
  );
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(RouterProvider, { router }),
      ),
    );
  });
  await settle();
  return router;
}

function text(): string {
  return document.body.textContent ?? "";
}

/** A button by its text or its accessible name. */
function button(label: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>("button, a, [role=menuitem]"),
  ].find(
    (one) =>
      one.textContent?.trim() === label ||
      one.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No ${label} in:\n${text()}`);
  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

describe("the Accounts forms as URLs", () => {
  it("opens one account's form from its URL, and reads that one row", async () => {
    await render(editAccountHref(3));

    expect(text()).toContain("Edit Sample Savings");
    expect(asks).toContain("GET /api/tables/accounts/3");
  });

  it("opens the new-account form from its URL", async () => {
    await render(NEW_ACCOUNT_ROUTE);

    expect(text()).toContain("New account");
    expect(text()).toContain("Save");
  });

  it("saves the account the URL named", async () => {
    const router = await render(editAccountHref(3));

    await click("Save");

    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/accounts/3",
        body: {
          name: "Sample Savings",
          account_type: "Asset",
          parent_id: 2,
        },
      },
    ]);
    expect(router.state.location.pathname).toBe("/accounts");
  });

  it("creates a new account, then returns to the chart", async () => {
    const router = await render(NEW_ACCOUNT_ROUTE);

    const name = [...document.querySelectorAll("label")].find(
      (one) => one.textContent?.trim() === "Name",
    );
    const input = name && document.getElementById(name.htmlFor);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`No Name field in:\n${text()}`);
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Sample Holiday");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save");

    expect(sent).toEqual([
      {
        method: "POST",
        path: "/api/tables/accounts",
        body: {
          name: "Sample Holiday",
          account_type: "Asset",
          parent_id: null,
        },
      },
    ]);
    expect(router.state.location.pathname).toBe("/accounts");
  });

  it("brings the chart's query string back with it", async () => {
    const query = "?filter[account_type][is]=Asset&page=2";
    const router = await render(`${editAccountHref(3)}${query}`);

    await click("Cancel");

    expect(router.state.location.pathname).toBe("/accounts");
    expect(router.state.location.search).toBe(query);
  });

  it("says so when the link names an account the books don't have", async () => {
    const router = await render(editAccountHref(999));

    expect(text()).toContain("That account isn't in your books");

    await click("Close");
    expect(router.state.location.pathname).toBe("/accounts");
  });

  it("says so when the link's account number isn't one", async () => {
    await render("/accounts/horse/edit");

    expect(text()).toContain("No account in this link");
    expect(asks).not.toContain("GET /api/tables/accounts/horse");
  });
});
