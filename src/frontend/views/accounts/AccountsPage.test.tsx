// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TableSchema } from "@sapporta/shared/contracts";
import { useSchemaStore } from "@sapporta/frontend";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountsPage } from "./AccountsPage";
import { EditAccountDialog, NewAccountDialog } from "./AccountDialogRoute";
import { EDIT_ACCOUNT_PATH, NEW_ACCOUNT_PATH, editAccountHref } from "./routes";

/*
 * The chart on screen with a form open: the chart is not rebuilt. The grid
 * keeps one session per definition, so the columns it is given have to be
 * made once for the page's life — a new builder tears the session down, and
 * the user's place in the chart (its page, its expanded rows, where they had
 * scrolled) goes with it.
 */

const ACCOUNTS: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  columns: [
    { name: "id", label: "Id", kind: "number", primary: true },
    { name: "name", label: "Name", kind: "text" },
    {
      name: "parent_id",
      label: "Parent",
      kind: "number",
      foreignKey: { table: "accounts", column: "id" },
    },
    { name: "account_type", label: "Type", kind: "text" },
  ],
  children: [],
  rowLabelColumns: ["name"],
  searchable: false,
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors-and-descendants",
  },
};

const ROWS = [
  { id: 1, name: "Assets", parent_id: null, account_type: "Asset" },
  { id: 2, name: "Bank Accounts", parent_id: 1, account_type: "Asset" },
  { id: 3, name: "Sample Savings", parent_id: 2, account_type: "Asset" },
];

let host: HTMLDivElement;
let root: Root;
let requests: string[];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function rowsResponse(data: unknown[]): Response {
  return Response.json({
    data,
    meta: { total: data.length, page: 1, limit: 50, pages: 1 },
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  requests = [];
  useSchemaStore.setState({
    tables: [ACCOUNTS],
    loaded: true,
    loading: false,
    error: null,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(String(request?.url ?? input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}${url.search}`);

      const one = /\/tables\/accounts\/(\d+)$/.exec(url.pathname);
      if (method === "GET" && one) {
        const row = ROWS.find((account) => account.id === Number(one[1]));
        return Response.json({ data: row });
      }
      if (method === "GET" && url.pathname.endsWith("/tables/accounts")) {
        return rowsResponse(ROWS);
      }
      if (method === "GET" && url.pathname.endsWith("/import-presets")) {
        return Response.json({ institutions: [] });
      }
      if (method === "GET" && url.pathname.endsWith("/journal_entries")) {
        return rowsResponse([]);
      }
      return Response.json({ error: "Not here" }, { status: 404 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  useSchemaStore.getState().reset();
});

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(url = "/accounts") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            MemoryRouter,
            { initialEntries: [url] },
            createElement(LocationProbe),
            createElement(
              Routes,
              null,
              createElement(
                Route,
                { path: "accounts", element: createElement(AccountsPage) },
                createElement(Route, {
                  path: NEW_ACCOUNT_PATH,
                  element: createElement(NewAccountDialog),
                }),
                createElement(Route, {
                  path: EDIT_ACCOUNT_PATH,
                  element: createElement(EditAccountDialog),
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });
  await settle();
}

/** Where the page is, as the URL, for the tests that check the form's own. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return createElement("span", { "data-location": `${pathname}${search}` });
}

function location(): string {
  const probe = document.querySelector("[data-location]");
  if (probe === null) throw new Error("No location probe");
  return probe.getAttribute("data-location") ?? "";
}

/** The chart's own reads: the tree page the grid root asks for. */
function chartReads(): number {
  return requests.filter((one) => one.includes("tree=")).length;
}

/** The row the user is looking at, as the grid renders it. */
function rowOf(name: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>("[data-grid-part=row]"),
  ].find((one) => one.textContent?.includes(name));
  if (!found) throw new Error(`No row ${name} in:\n${text()}`);
  return found;
}

function text(): string {
  return document.body.textContent ?? "";
}

/** The box the chart scrolls in: where the user is in a long chart. */
function chartScroller(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".overflow-auto");
  if (found === null) throw new Error(`No scroller in:\n${text()}`);
  return found;
}

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

/** Clicks the control `label` names inside `scope`. */
async function clickIn(scope: HTMLElement, label: string) {
  const found = [...scope.querySelectorAll<HTMLElement>("button, a")].find(
    (one) =>
      one.textContent?.trim() === label ||
      one.getAttribute("aria-label") === label,
  );
  if (!found)
    throw new Error(`No ${label} in ${scope.textContent}:\n${text()}`);
  await act(async () => found.click());
  await settle();
}

describe("the chart with a form open", () => {
  it("edits a row at a URL a link can point at", async () => {
    await render();

    const row = rowOf("Sample Savings");
    const link = row.querySelector("a.account-edit-cell");
    expect(link?.getAttribute("href")).toBe(editAccountHref(3));

    await clickIn(row, "Edit account");

    expect(location()).toBe(editAccountHref(3));
    expect(text()).toContain("Edit Sample Savings");
  });

  it("leaves a modified click to the browser", async () => {
    await render();

    const link = rowOf("Sample Savings").querySelector("a.account-edit-cell")!;
    await act(async () =>
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      ),
    );
    await settle();

    // A new tab, not a form opened in this one.
    expect(location()).toBe("/accounts");
    expect(text()).not.toContain("Edit Sample Savings");
  });

  it("keeps the grid it had when a row's form opens", async () => {
    await render();

    const row = rowOf("Sample Savings");
    const scroller = chartScroller();
    // Two pages down the chart, as a user who has been reading it would be.
    scroller.scrollTop = 240;
    const readsBefore = chartReads();

    await clickIn(row, "Edit account");

    expect(text()).toContain("Edit Sample Savings");
    // The row, and the box it sits in, are the same elements: the chart was
    // not torn down and built again behind the form, so the user is where
    // they were.
    expect(document.contains(row)).toBe(true);
    expect(chartScroller()).toBe(scroller);
    expect(scroller.scrollTop).toBe(240);
    expect(chartReads()).toBe(readsBefore);
  });

  it("keeps the chart's page while a form is open, and after it closes", async () => {
    await render("/accounts?page=2");

    const row = rowOf("Sample Savings");
    const scroller = chartScroller();
    const readsBefore = chartReads();
    expect(readsBefore).toBeGreaterThan(0);

    await clickIn(row, "Edit account");

    // A form must not push the chart back to its first page, whatever the
    // form's own URL says.
    expect(document.contains(row)).toBe(true);
    expect(chartScroller()).toBe(scroller);
    expect(chartReads()).toBe(readsBefore);

    await clickIn(document.body, "Cancel");

    // Closing steps back to the chart's own entry, page and filters intact,
    // without reading the page of rows again.
    expect(location()).toBe("/accounts?page=2");
    expect(document.contains(row)).toBe(true);
    expect(chartScroller()).toBe(scroller);
    expect(chartReads()).toBe(readsBefore);
  });

  it("keeps the grid it had when the new-account form opens", async () => {
    await render();

    const row = rowOf("Sample Savings");
    const scroller = chartScroller();
    scroller.scrollTop = 240;
    const readsBefore = chartReads();

    await click("New record");

    expect(text()).toContain("New account");
    expect(document.contains(row)).toBe(true);
    expect(chartScroller()).toBe(scroller);
    expect(scroller.scrollTop).toBe(240);
    expect(chartReads()).toBe(readsBefore);
  });
});
