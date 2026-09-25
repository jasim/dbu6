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
} from "../../shared/index";
import { BanksStep } from "./BanksStep";

/*
 * Step 2 on screen: the empty state's two buttons, one flat table with its
 * marks, and the add dialog, which asks for the bank, names the account
 * after it, and asks for a number only when the bank has another account.
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
      // The wizard's own status, which this step doesn't need.
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

async function renderStep(rows: StatementAccountRow[]) {
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
          { initialEntries: ["/setup/banks"] },
          createElement(BanksStep),
        ),
      ),
    );
  });
  await settle();
}

function text(): string {
  return document.body.textContent ?? "";
}

function button(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("button, a")].find(
    (one) => one.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No ${label} button in:\n${text()}`);
  return found;
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

describe("BanksStep", () => {
  it("starts empty, with a button for each kind", async () => {
    await renderStep([]);

    expect(text()).toContain("Add your banks and cards");
    expect(text()).toContain("Add the accounts you get statements for");
    expect(button("+ Bank account")).toBeTruthy();
    expect(button("+ Credit card")).toBeTruthy();
    expect(button("Skip for now").getAttribute("href")).toBe("/setup/review");
    expect(text()).not.toContain("Next: First statements");
  });

  it("lists every account in one table, locked ones without a menu", async () => {
    await renderStep([
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
    expect(button("Next: First statements").getAttribute("href")).toBe(
      "/setup/statements",
    );
  });

  it("adds a bank account from its bank's name alone", async () => {
    await renderStep([]);
    await act(async () => button("+ Bank account").click());

    expect(text()).toContain("Add a bank account");
    expect(tuckedAway(field("Account number"))).toBe(true);
    expect(tuckedAway(field("Under"))).toBe(true);

    await act(async () => type(field("Bank"), "Other Bank"));
    expect(field("Name").value).toBe("Other Bank Savings");

    await act(async () => button("Add account").click());
    await settle();
    expect(posts).toEqual([
      {
        action: "create",
        kind: "bank",
        institution: "Other Bank",
        identifier: null,
        ledger: { source: "new", name: "Other Bank Savings", parent_id: 2 },
      },
    ]);
  });

  it("asks for the number when the bank already has an account", async () => {
    await renderStep([savings]);
    await act(async () => button("+ Bank account").click());
    await act(async () => type(field("Bank"), "Sample Bank"));

    const number = field("Account number");
    expect(tuckedAway(number)).toBe(false);
    expect(text()).toContain(
      "Sample Bank already has Sample Bank Savings. This tells their statements apart.",
    );

    await act(async () => button("Add account").click());
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Sample Bank already has Sample Bank Savings, so each needs its number.",
    );
    expect(posts).toEqual([]);
  });

  it("opens More options when the problem is a field in it", async () => {
    await renderStep([]);
    await act(async () => button("+ Bank account").click());
    await act(async () => type(field("Bank"), "Other Bank"));
    await act(async () => type(field("Account number"), "0505 NOPII"));
    expect(tuckedAway(field("Account number"))).toBe(true);

    await act(async () => button("Add account").click());
    await settle();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "An account number is digits only.",
    );
    expect(tuckedAway(field("Account number"))).toBe(false);
    expect(posts).toEqual([]);
  });

  it("takes a bank typed in another case as the one the books know", async () => {
    await renderStep([savings]);
    await act(async () => button("+ Bank account").click());
    await act(async () => type(field("Bank"), "  sample   BANK "));

    // Sample Bank has an account, so the number is asked for; the name
    // doesn't collide with it.
    expect(tuckedAway(field("Account number"))).toBe(false);
    expect(field("Name").value).toBe("Sample Bank Savings 2");
    await act(async () => type(field("Account number"), "050505000078"));
    await act(async () => button("Add account").click());
    await settle();

    expect(posts).toMatchObject([{ institution: "Sample Bank" }]);
  });

  it("keeps the dialog open with the server's refusal", async () => {
    await renderStep([]);
    refusal = {
      error: "Your books already have an account named Sample Card.",
      code: "ledger_name_taken",
    };
    await act(async () => button("+ Credit card").click());
    expect(text()).toContain("Add a credit card");
    expect(text()).toContain("Card issuer");

    await act(async () => type(field("Card issuer"), "Sample Issuer"));
    expect(field("Name").value).toBe("Sample Issuer Credit Card");
    await act(async () => button("Add account").click());
    await settle();

    expect(posts).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Your books already have an account named Sample Card.",
    );
    expect(text()).toContain("Add a credit card");
  });
});
