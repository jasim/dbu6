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
import type { AccountRow } from "../../queries";
import {
  accountsLookupResponse,
  accountsTablePage,
  serveAccountsSchema,
} from "../../accounts-page.testing";

/*
 * The Accounts page's edit form on screen: a new account on the table API,
 * an existing one through PUT /api/accounts/:id, a refusal on the field it
 * names, and a delete that stops at what the form already knows.
 *
 * Assets (1) > Bank Accounts (2) > Sample Savings (3), Sample Wallet (4);
 * Expenses (5) > Groceries (6). Sample Savings is a bank's account; Sample
 * Wallet has an opening balance of 5000. A new account is saved as id 7.
 */

const OPENING_BALANCES = {
  equity_account: { id: 9, name: "Opening Balances" },
  accounts: [
    {
      account_id: 3,
      name: "Sample Savings",
      path: "Assets > Bank Accounts > Sample Savings",
      account_type: "Asset",
      section: "statement",
      first_activity_date: null,
      default_date: null,
      implied_opening: null,
      opening: null,
    },
    {
      account_id: 4,
      name: "Sample Wallet",
      path: "Assets > Bank Accounts > Sample Wallet",
      account_type: "Asset",
      section: "own",
      first_activity_date: null,
      default_date: "2026-03-31",
      implied_opening: null,
      opening: {
        journal_id: 50,
        date: "2026-03-31",
        amount: 5000,
        description: "Opening balance",
        locked: null,
        source: "manual",
      },
    },
  ],
  unanswered: [
    {
      account_id: 3,
      name: "Sample Savings",
      path: "Assets > Bank Accounts > Sample Savings",
      account_type: "Asset",
    },
  ],
  empty_groups: [],
  wrong_side: [],
};

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
let unserveSchema: () => void;

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
  unserveSchema = serveAccountsSchema();
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

      const lookup = accountsLookupResponse(CHART, url);
      if (lookup !== null) return lookup;
      if (method === "GET" && url.pathname.endsWith("/tables/accounts")) {
        return Response.json(accountsTablePage(CHART));
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
      if (method === "GET" && url.pathname.endsWith("/opening-balances")) {
        return Response.json(OPENING_BALANCES);
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
        return Response.json({
          data: { id: 7, ...(body === null ? {} : JSON.parse(body)) },
        });
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
  unserveSchema();
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

/** Opens the combobox a control names, and lists its options' text. */
async function open(triggerLabel: string): Promise<string[]> {
  const trigger = button(triggerLabel);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
  });
  await settle();
  return options().map((one) => one.textContent ?? "");
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** The open list's options that can be picked, by their text. */
function pickable(): string[] {
  return options()
    .filter((one) => !one.hasAttribute("data-disabled"))
    .map((one) => one.textContent ?? "");
}

/** Opens the combobox a control names, and picks an option by its text. */
async function choose(triggerLabel: string, option: string) {
  await open(triggerLabel);
  const choice = options().find((one) => one.textContent?.includes(option));
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
  });

  it("offers a new asset its opening balance, or closes on Not now", async () => {
    await render("new");

    await act(async () => type(field("Name"), "Sample Holiday"));
    await save();

    expect(closed).toBe(0);
    expect(text()).toContain("Sample Holiday added");
    expect(text()).toContain("Record what it held when your books start.");
    expect(button("Record its opening balance").getAttribute("href")).toBe(
      "/settings/balances/7/edit?account=Sample+Holiday",
    );

    await act(async () => button("Not now").click());
    expect(closed).toBe(1);
  });

  it("closes once a new account outside assets and liabilities is saved", async () => {
    await render("new");

    await act(async () => type(field("Name"), "Sample Holiday"));
    await choose("Show the choices", "Groceries");
    await save();

    expect(closed).toBe(1);
    expect(text()).not.toContain("opening balance");
  });

  it("shows an account's opening balance and links to its form", async () => {
    await render(accountOf("Sample Wallet"));

    expect(text()).toContain("Opening balance");
    expect(text()).toContain("31 Mar 2026");
    expect(button("Change").getAttribute("href")).toBe(
      "/settings/balances/4/edit?account=Sample+Wallet",
    );
  });

  it("shows no opening balance for a bank, whose statements set it", async () => {
    await render(accountOf("Sample Savings"));

    expect(text()).not.toContain("Opening balance");
  });

  it("takes a new account's category from the parent chosen", async () => {
    await render("new");

    await act(async () => type(field("Name"), "Sample Holiday"));
    await choose("Show the choices", "Groceries");

    await save();

    expect(sent).toEqual([
      {
        method: "POST",
        path: "/api/tables/accounts",
        body: {
          name: "Sample Holiday",
          account_type: "Expense",
          parent_id: 6,
        },
      },
    ]);
  });

  it("clears the parent to make a top-level account", async () => {
    await render(accountOf("Groceries"));

    await act(async () => button("Make it a top-level account").click());
    await settle();
    await save();

    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/api/accounts/6",
        body: { name: "Groceries", account_type: "Expense", parent_id: null },
      },
    ]);
  });

  it("offers a fixed type's accounts as parents, outside its own branch", async () => {
    // Bank Accounts holds a bank, so it stays an Asset. It shows where it
    // sits, greyed, and nothing under it is listed.
    await render(accountOf("Bank Accounts"));

    expect(await open("Show the choices")).toEqual([
      "Assets",
      "Bank Accounts (this account)",
    ]);
    expect(pickable()).toEqual(["Assets"]);
  });

  it("offers any account as a parent while the type is free", async () => {
    await render(accountOf("Groceries"));

    // The chart's tree, top accounts by type.
    expect(await open("Show the choices")).toEqual([
      "Assets",
      "Bank Accounts",
      "Sample Savings",
      "Sample Wallet",
      "Expenses",
      "Groceries (this account)",
    ]);
    expect(pickable()).not.toContain("Groceries (this account)");
  });

  it("shows the chosen parent's path in the field, and its own type", async () => {
    await render(accountOf("Sample Wallet"));

    expect(text()).toContain("Assets >");
    expect(field("Belongs under").value).toBe("Bank Accounts");
    // A top account's name need not name its type, so Category shows it.
    expect(text()).toContain("CategoryAssets");
  });

  it("lists a search's matches with their paths", async () => {
    await render("new");

    await open("Show the choices");
    await act(async () => type(field("Belongs under"), "sample"));
    await settle();

    expect(options().map((one) => one.textContent)).toEqual([
      "Assets > Bank Accounts > Sample Savings",
      "Assets > Bank Accounts > Sample Wallet",
    ]);
  });

  it("retypes with sub-accounts, says what moves, and puts the change", async () => {
    await render(accountOf("Expenses"));

    await choose("Show the categories", "Income");

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
