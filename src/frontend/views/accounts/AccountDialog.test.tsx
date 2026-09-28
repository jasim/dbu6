// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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
import { AccountDialog } from "./AccountDialog";
import type { AccountRow } from "./account-form";

/*
 * The Accounts page's edit form on screen: a new account on the table API,
 * an existing one through PUT /api/accounts/:id, a refusal on the field it
 * names, and a delete that stops at what the form already knows.
 *
 * Assets (1) > Bank Accounts (2) > Sample Savings (3), Sample Wallet (4);
 * Expenses (5) > Groceries (6). Sample Savings is a bank's account.
 */

const CHART: AccountRow[] = [
  { id: 1, name: "Assets", parent_id: null, account_type: "Asset" },
  { id: 2, name: "Bank Accounts", parent_id: 1, account_type: "Asset" },
  { id: 3, name: "Sample Savings", parent_id: 2, account_type: "Asset" },
  { id: 4, name: "Sample Wallet", parent_id: 2, account_type: "Asset" },
  { id: 5, name: "Expenses", parent_id: null, account_type: "Expense" },
  { id: 6, name: "Groceries", parent_id: 5, account_type: "Expense" },
];

const accountOf = (name: string): AccountRow => {
  const found = CHART.find((one) => one.name === name);
  if (!found) throw new Error(`No account ${name}`);
  return found;
};

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let host: HTMLDivElement;
let root: Root;
let sent: Sent[];
let refusal: { error: string; code: string; field: string | null } | null;
let closed: number;

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
  refusal = null;
  closed = 0;
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
      const accountPath = /\/accounts\/\d+$/.test(url.pathname);

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
      if (accountPath && (method === "PUT" || method === "DELETE")) {
        sent.push({
          method,
          path: url.pathname,
          body: body === null || body === "" ? null : JSON.parse(body),
        });
        if (refusal) return Response.json(refusal, { status: 422 });
        if (method === "DELETE") {
          // As the server sends it: nothing, labelled JSON.
          return new Response(null, {
            status: 204,
            headers: { "Content-Type": "application/json" },
          });
        }
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

async function render(editing: AccountRow | "new") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/accounts"] },
          createElement(AccountDialog, {
            editing,
            onClose: () => {
              closed += 1;
            },
          }),
        ),
      ),
    );
  });
  await settle();
}

function text(): string {
  return document.body.textContent ?? "";
}

/** The input a label names; the dialog renders in a portal. */
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

/** A button or link by its text or its accessible name. */
function button(label: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>(
      "button, a, [role=menuitem], [role=option]",
    ),
  ].find(
    (one) =>
      one.textContent?.trim() === label ||
      one.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No ${label} in:\n${text()}`);
  return found;
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

async function save() {
  await act(async () => button("Save").click());
  await settle();
}

describe("AccountDialog", () => {
  it("creates a new account on the table API", async () => {
    await render("new");

    await act(async () => type(field("Name"), "Sample Holiday"));
    await save();

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
    expect(closed).toBe(1);
  });

  it("retypes with sub-accounts, says what moves, and puts the change", async () => {
    await render(accountOf("Expenses"));

    await choose("Show the account types", "Income");

    expect(text()).toContain(
      "Its 1 sub-account moves to Income with it. They'll show under Income in reports.",
    );
    await save();

    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/accounts/5",
        body: { name: "Expenses", account_type: "Revenue", parent_id: null },
      },
    ]);
    expect(closed).toBe(1);
  });

  it("puts a 422 with a field on that field", async () => {
    await render(accountOf("Sample Savings"));
    refusal = {
      error: "Your books already have an account named Sample Savings.",
      code: "ledger_name_taken",
      field: "name",
    };

    await act(async () => type(field("Name"), "Sample Savings"));
    await save();

    expect(sent).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Your books already have an account named Sample Savings.",
    );
    expect(field("Name").getAttribute("aria-invalid")).toBe("true");
    expect(closed).toBe(0);
  });

  it("shows a blocked delete's reason without sending it", async () => {
    await render(accountOf("Assets"));

    await act(async () => button("Delete").click());
    await settle();

    expect(text()).toContain(
      "Assets has 1 sub-account under it; delete it first.",
    );
    expect(text()).toContain(
      "Assets is a bank or card. Remove it in Settings › Banks & cards.",
    );
    expect(sent).toEqual([]);
  });

  it("confirms and deletes an empty account", async () => {
    await render(accountOf("Groceries"));

    await act(async () => button("Delete").click());
    await settle();
    expect(text()).toContain("Delete Groceries?");

    await act(async () => button("Delete").click());
    await settle();

    expect(sent).toEqual([
      { method: "DELETE", path: "/api/accounts/6", body: null },
    ]);
    // The 204's empty body must not be read as JSON: the dialog closes and
    // nothing is shown as a failure.
    expect(closed).toBe(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
