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
import { accountsLookup } from "../../accounts-page.testing";

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
/** The accounts the stubbed server holds; a POST adds to them. */
let rows: (typeof ROWS)[number][];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

/** The accounts a search finds, with the branches above them. */
function searched(q: string | null): typeof rows {
  if (q === null) return rows;
  const kept = new Set<number>();
  for (const found of rows.filter((one) => one.name.includes(q))) {
    let at: (typeof rows)[number] | undefined = found;
    while (at !== undefined) {
      kept.add(at.id);
      at = rows.find((one) => one.id === at?.parent_id);
    }
  }
  return rows.filter((one) => kept.has(one.id));
}

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
  rows = [...ROWS];
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
        const row = rows.find((account) => account.id === Number(one[1]));
        return Response.json({ data: row });
      }
      if (method === "GET" && url.pathname.endsWith("/tables/accounts")) {
        return rowsResponse(searched(url.searchParams.get("q")));
      }
      if (url.pathname.endsWith("/tables/accounts/_lookup")) {
        // The form's parent picker.
        return Response.json(accountsLookup(rows, url));
      }
      if (method === "POST" && url.pathname.endsWith("/tables/accounts")) {
        const body = JSON.parse(
          String(request ? await request.text() : init?.body),
        ) as Omit<(typeof ROWS)[number], "id">;
        const created = { id: rows.length + 1, ...body };
        rows = [...rows, created];
        return Response.json({ data: created }, { status: 201 });
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

/** The input a label names; the form renders in a portal. */
function field(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll("label")].find(
    (one) => one.textContent?.trim() === label,
  );
  const input = found && document.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`No ${label} field in:\n${text()}`);
  }
  return input;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Opens the combobox a control names, and picks an option by its text. */
async function choose(triggerLabel: string, option: string) {
  const trigger = button(triggerLabel);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
  });
  await settle();
  const choice = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((one) => one.textContent?.includes(option));
  if (!choice) throw new Error(`No option ${option} in:\n${text()}`);
  await act(async () => choice.click());
  await settle();
}

/** Saves a new account from the New record form. */
async function addAccount(name: string, parent?: string) {
  await click("New record");
  await act(async () => type(field("Name"), name));
  if (parent !== undefined) await choose("Open popup", parent);
  await click("Save");
}

/** The rows the grid scrolled into view, by their text. */
function scrolledTo(): string[] {
  return scrolls.map(
    (one) => one.closest("[data-grid-part=row]")?.textContent ?? "",
  );
}

let scrolls: Element[];
const scrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolls = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolls.push(this);
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe("a new account", () => {
  it("is on screen with the cursor on it once saved", async () => {
    await render();

    await addAccount("Sample Holiday");

    expect(location()).toBe("/accounts");
    const row = rowOf("Sample Holiday");
    expect(row.getAttribute("data-row-active")).toBe("true");
    expect(scrolledTo().some((one) => one.includes("Sample Holiday"))).toBe(
      true,
    );
  });

  it("opens the branches above it", async () => {
    useSchemaStore.setState({
      tables: [
        { ...ACCOUNTS, tree: { ...ACCOUNTS.tree!, defaultExpanded: false } },
      ],
    });
    await render();
    expect(text()).not.toContain("Sample Savings");

    await addAccount("Sample Deposit", "Bank Accounts");

    expect(rowOf("Sample Deposit").getAttribute("data-row-active")).toBe(
      "true",
    );
    expect(text()).toContain("Bank Accounts");
  });

  it("drops a search that would hide it", async () => {
    await render("/accounts?q=Savings&sort=name");

    await addAccount("Sample Holiday");

    expect(location()).toBe("/accounts?sort=name");
    expect(rowOf("Sample Holiday").getAttribute("data-row-active")).toBe(
      "true",
    );
  });
});
