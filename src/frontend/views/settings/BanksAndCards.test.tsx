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
import type {
  StatementAccountRow,
  StatementAccounts,
} from "../../../shared/index";
import { BanksAndCards } from "./BanksAndCards";

/*
 * Settings' Banks & cards on screen: one flat table with its marks, the
 * edit dialog, which asks for a number in view only when the bank has
 * another account, and removal, of a deleted account's row too. Adding is
 * /add's, which the page links to.
 */

let host: HTMLDivElement;
let root: Root;
let accounts: StatementAccounts;
let posts: unknown[];
let refusal: { error: string; code: string } | null;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const savings: StatementAccountRow = {
  account_id: 8,
  name: "Sample Bank Savings",
  kind: "bank",
  institution: "Sample Bank",
  account_identifiers: ["050505000012"],
  parent: { id: 2, name: "Bank Accounts" },
  in_ledger: true,
  entries: 0,
  drafts: 0,
};

const card: StatementAccountRow = {
  account_id: 9,
  name: "Sample Card",
  kind: "card",
  institution: "Sample Issuer",
  account_identifiers: [],
  parent: { id: 4, name: "Credit Cards" },
  in_ledger: true,
  entries: 40,
  drafts: 2,
};

function books(rows: StatementAccountRow[]): StatementAccounts {
  return {
    institutions: [
      { name: "Sample Bank", parsers: [] },
      { name: "Sample Issuer", parsers: [] },
    ],
    accounts: rows,
    parents: {
      bank: [{ id: 2, name: "Bank Accounts", path: "Assets:Bank Accounts" }],
      card: [{ id: 4, name: "Credit Cards", path: "Liabilities:Credit Cards" }],
    },
    default_parents: { bank: 2, card: 4 },
    mixed_parents: { bank: false, card: false },
    unlisted: [],
    account_names: [
      "Bank Accounts",
      "Credit Cards",
      ...rows.filter((row) => row.in_ledger).map((row) => row.name),
    ],
  };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posts = [];
  refusal = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(String(request?.url ?? input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      if (url.pathname.endsWith("/setup/statement-accounts")) {
        if (method === "POST") {
          const body = request ? await request.text() : String(init?.body);
          posts.push(JSON.parse(body));
          if (refusal) return Response.json(refusal, { status: 422 });
        }
        return Response.json(accounts);
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

async function renderPage(rows: StatementAccountRow[]) {
  accounts = books(rows);
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
          { initialEntries: ["/settings/banks"] },
          createElement(BanksAndCards),
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

/** Whether a field is under the closed "More options". */
function tuckedAway(input: HTMLElement): boolean {
  const details = input.closest("details");
  return details !== null && !details.open;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** A button, link or menu item by its text or its label. */
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

/** Opens a row's "⋯" menu and picks an item. */
async function choose(name: string, item: "Edit" | "Remove") {
  const trigger = button(`Actions for ${name}`);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
  });
  await settle();
  await act(async () => button(item).click());
  await settle();
}

describe("BanksAndCards", () => {
  it("links to /add when there are none, with no add buttons", async () => {
    await renderPage([]);

    expect(text()).toContain("No banks or cards yet");
    expect(button("Add a bank or card").getAttribute("href")).toBe("/add");
    expect(text()).not.toContain("+ Bank account");
    expect(text()).not.toContain("+ Credit card");
  });

  it("lists every account in one table, locked ones without a menu", async () => {
    await renderPage([
      savings,
      card,
      {
        ...savings,
        account_id: 10,
        name: "Sample Gone",
        account_identifiers: ["050505000034"],
        in_ledger: false,
      },
      {
        ...savings,
        account_id: 11,
        name: "Sample Joint",
        account_identifiers: ["050505000056"],
        drafts: 3,
      },
    ]);

    const rows = [...document.querySelectorAll("tbody tr")];
    // Type, Bank and Number: the cells after the account's own.
    const cells = (row: Element) =>
      [...row.querySelectorAll("td")].slice(1, 4).map((td) => td.textContent);
    expect(rows.map(cells)).toEqual([
      ["Bank account", "Sample Bank", "ending 0012"],
      ["Credit card", "Sample Issuer", "— from statement"],
      ["Bank account", "Sample Bank", "ending 0034"],
      ["Bank account", "Sample Bank", "ending 0056"],
    ]);
    expect(rows[2].textContent).toContain("Deleted from your books");
    expect(
      rows[1].querySelector(
        '[aria-label="Has transactions, so it can\'t change here."]',
      ),
    ).not.toBeNull();
    // Only transactions still to review: deleting them unlocks it.
    expect(
      rows[3].querySelector(
        '[aria-label="Has transactions to review. Delete them in Review to change it."]',
      ),
    ).not.toBeNull();
    expect(rows[1].querySelector('[aria-label^="Actions for"]')).toBeNull();
    expect(
      rows[0].querySelector('[aria-label="Actions for Sample Bank Savings"]'),
    ).not.toBeNull();
    expect(button("Add a bank or card").getAttribute("href")).toBe("/add");
  });

  it("edits a row, the number tucked away while it is optional", async () => {
    await renderPage([savings, card]);
    await choose("Sample Bank Savings", "Edit");

    expect(text()).toContain("Edit Sample Bank Savings");
    expect(field("Bank").value).toBe("Sample Bank");
    expect(tuckedAway(field("Account number"))).toBe(true);
    expect(tuckedAway(field("Under"))).toBe(true);

    await act(async () => type(field("Name"), "Sample Joint Savings"));
    await act(async () => button("Save").click());
    await settle();
    expect(posts).toEqual([
      {
        action: "update",
        account_id: 8,
        kind: "bank",
        institution: "Sample Bank",
        name: "Sample Joint Savings",
        identifier: "050505000012",
        parent_id: 2,
      },
    ]);
    expect(document.querySelector("form")).toBeNull();
  });

  it("asks for the number in view when the bank has another account", async () => {
    await renderPage([
      savings,
      {
        ...savings,
        account_id: 12,
        name: "Sample Bank Current",
        account_identifiers: ["050505000078"],
      },
    ]);
    await choose("Sample Bank Savings", "Edit");

    const number = field("Account number");
    expect(tuckedAway(number)).toBe(false);
    expect(text()).toContain(
      "Sample Bank already has Sample Bank Current. This tells their statements apart.",
    );
    await act(async () => type(number, ""));
    await act(async () => button("Save").click());
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Sample Bank already has Sample Bank Current, so each needs its number.",
    );
    expect(posts).toEqual([]);
  });

  it("opens More options when the problem is a field in it", async () => {
    await renderPage([savings]);
    await choose("Sample Bank Savings", "Edit");
    await act(async () => type(field("Account number"), "0505 NOPII"));

    await act(async () => button("Save").click());
    await settle();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "An account number is digits only.",
    );
    expect(tuckedAway(field("Account number"))).toBe(false);
    expect(posts).toEqual([]);
  });

  it("keeps the dialog open with the server's refusal", async () => {
    await renderPage([savings]);
    refusal = {
      error: "Your books already have an account named Sample Card.",
      code: "ledger_name_taken",
    };
    await choose("Sample Bank Savings", "Edit");
    await act(async () => type(field("Name"), "Sample Card"));
    await act(async () => button("Save").click());
    await settle();

    expect(posts).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Your books already have an account named Sample Card.",
    );
    expect(text()).toContain("Edit Sample Bank Savings");
  });

  it("removes a row whose account was deleted from the books", async () => {
    const gone = { ...savings, name: "Sample Gone", in_ledger: false };
    await renderPage([gone]);
    await choose("Sample Gone", "Remove");

    expect(text()).toContain("Remove Sample Gone?");
    // Its account is already gone from the chart.
    expect(text()).not.toContain("Also delete it from your chart of accounts");
    await act(async () => button("Remove").click());
    await settle();
    expect(posts).toEqual([
      { action: "remove", account_id: 8, delete_account: false },
    ]);
  });

  it("offers only Remove on a deleted account's row", async () => {
    await renderPage([{ ...savings, name: "Sample Gone", in_ledger: false }]);
    const trigger = button("Actions for Sample Gone");
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger.click();
    });
    await settle();
    expect(() => button("Edit")).toThrow();
    expect(button("Remove")).toBeTruthy();
  });
});
