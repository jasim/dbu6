// @vitest-environment happy-dom
import { balancesOf } from "../../opening-balances.testing";
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
import type {
  OpeningBalanceAccount,
  OpeningBalances as OpeningBalancesList,
} from "../../../shared/index";
import { openingBalancesQuery } from "../../queries";
import { OpeningBalances } from "./OpeningBalances";
import { EditOpeningBalanceDialog } from "./OpeningBalanceDialogRoute";
import {
  BALANCES_SETTINGS_ROUTE,
  EDIT_BALANCE_PATH,
  balanceFormHref,
} from "./routes";
import { accountsTablePage } from "../../accounts-page.testing";

/*
 * Settings' Opening balances on screen: the recorded balances, what you
 * own, what you owe, then the banks and cards; one dialog per account that
 * takes the amount the user's way up; locked balances pointing to their
 * journal entry; and a link naming an account with none landing on its row
 * with its form, the one way a balance is recorded here.
 */

// A date the books don't give opens on today, in the workspace's zone.
vi.mock("../../reports/shared", () => ({ today: () => "2026-09-25" }));

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let balances: OpeningBalancesList;
let sent: { method: string; path: string; body: unknown }[];
let refusal: Answer | null;
let lists: number;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function account(
  account_id: number,
  name: string,
  path: string,
  more: Partial<OpeningBalanceAccount> = {},
): OpeningBalanceAccount {
  return {
    account_id,
    name,
    path,
    account_type: path.startsWith("Liabilities") ? "Liability" : "Asset",
    section: path.startsWith("Liabilities") ? "owe" : "own",
    first_activity_date: null,
    default_date: "2026-03-31",
    implied_opening: null,
    opening: null,
    ...more,
  };
}

const opening = (journal_id: number, amount: number, more = {}) => ({
  journal_id,
  date: "2026-03-31",
  amount,
  description: "Opening balance",
  locked: null,
  source: "manual" as const,
  ...more,
});

const cash = account(3, "Cash", "Assets:Cash");
const investments = account(4, "Investments", "Assets:Investments", {
  section: null,
});
const epf = account(5, "EPF", "Assets:Investments:EPF", {
  opening: opening(21, 640000),
});
const ppf = account(6, "PPF", "Assets:Investments:PPF", {
  opening: opening(22, 210000, { locked: "has_entries" }),
});
const loan = account(
  7,
  "Sample Car Loan",
  "Liabilities:Loans:Sample Car Loan",
  {
    first_activity_date: "2026-04-05",
    default_date: "2026-04-04",
  },
);
const savings = account(
  8,
  "Sample Bank Savings",
  "Assets:Bank:Sample Bank Savings",
  {
    section: "statement",
    opening: opening(23, 12000, { source: "statement" }),
  },
);
const platinum = account(
  9,
  "Sample Card Platinum",
  "Liabilities:Cards:Sample Card Platinum",
  {
    section: "statement",
    // Changed from what its statement says was owed.
    opening: opening(24, -3000, { locked: "shared_entry" }),
  },
);
const gold = account(
  10,
  "Sample Card Gold",
  "Liabilities:Cards:Sample Card Gold",
  {
    section: "statement",
    first_activity_date: "2026-04-01",
    implied_opening: -3000,
  },
);

const ALL = [cash, investments, epf, ppf, loan, savings, platinum, gold];

// The books' accounts, which each row's parent path comes from.
const ACCOUNT_ROWS = [
  { id: 100, name: "Assets", parent_id: null, account_type: "Asset" },
  { id: 101, name: "Liabilities", parent_id: null, account_type: "Liability" },
  { id: 3, name: "Cash", parent_id: 100, account_type: "Asset" },
  { id: 4, name: "Investments", parent_id: 100, account_type: "Asset" },
  { id: 5, name: "EPF", parent_id: 4, account_type: "Asset" },
  { id: 6, name: "PPF", parent_id: 4, account_type: "Asset" },
  { id: 102, name: "Loans", parent_id: 101, account_type: "Liability" },
  { id: 7, name: "Sample Car Loan", parent_id: 102, account_type: "Liability" },
  {
    id: 11,
    name: "Sample Home Loan",
    parent_id: 102,
    account_type: "Liability",
  },
  { id: 103, name: "Bank", parent_id: 100, account_type: "Asset" },
  { id: 8, name: "Sample Bank Savings", parent_id: 103, account_type: "Asset" },
  { id: 104, name: "Cards", parent_id: 101, account_type: "Liability" },
  {
    id: 9,
    name: "Sample Card Platinum",
    parent_id: 104,
    account_type: "Liability",
  },
  {
    id: 10,
    name: "Sample Card Gold",
    parent_id: 104,
    account_type: "Liability",
  },
];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  sent = [];
  refusal = null;
  lists = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(String(request?.url ?? input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      const path = url.pathname.replace(/^\/api/, "");
      if (path.startsWith("/opening-balances")) {
        if (method === "GET") {
          lists += 1;
          return Response.json(balances);
        }
        const text = request ? await request.text() : String(init?.body ?? "");
        const body = text ? JSON.parse(text) : null;
        sent.push({ method, path, body });
        if (refusal)
          return Response.json(refusal.body, { status: refusal.status });
        return method === "POST"
          ? Response.json(
              {
                journal_id: 30,
                equity_account: { id: 1, name: "Opening Balances" },
                equity_account_created: false,
                date: body.date,
                amount: body.amount,
              },
              { status: 201 },
            )
          : Response.json(
              method === "PUT"
                ? { journal_id: 21 }
                : { removed_journal_id: 21 },
            );
      }
      if (method === "DELETE" && path.startsWith("/accounts/")) {
        sent.push({ method, path, body: null });
        return new Response(null, { status: 204 });
      }
      if (method === "GET" && path === "/tables/accounts") {
        return Response.json(accountsTablePage(ACCOUNT_ROWS));
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

async function renderPage(
  accounts: OpeningBalanceAccount[] | "refused",
  url = "/settings/balances",
  /** An older list, already in the cache when the page opens. */
  cached?: OpeningBalanceAccount[],
  /** The server's check over `accounts`. */
  unanswered: OpeningBalanceAccount[] = [],
) {
  if (accounts === "refused") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Only the owner can set up the books." },
          { status: 403 },
        ),
      ),
    );
  } else {
    balances = balancesOf(accounts, { unanswered });
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached) {
    client.setQueryData(openingBalancesQuery.queryKey, balancesOf(cached));
  }
  await act(async () => {
    root.render(
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
              {
                path: BALANCES_SETTINGS_ROUTE.slice(1),
                element: createElement(OpeningBalances),
              },
              createElement(Route, {
                path: EDIT_BALANCE_PATH,
                element: createElement(EditOpeningBalanceDialog),
              }),
            ),
          ),
        ),
      ),
    );
  });
  await settle();
}

/** Where the page is, as the URL, for the tests that check a link's target. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return createElement("span", { "data-location": `${pathname}${search}` });
}

/** The page's URL as the address bar holds it. */
function location(): string {
  const probe = document.querySelector("[data-location]");
  if (probe === null) throw new Error("No location probe");
  return probe.getAttribute("data-location") ?? "";
}

function text(): string {
  return document.body.textContent ?? "";
}

function button(label: string): HTMLElement {
  const found = [
    ...document.querySelectorAll<HTMLElement>("button, a, [role=menuitem]"),
  ].find(
    (one) =>
      one.textContent?.trim() === label ||
      one.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No ${label} button in:\n${text()}`);
  return found;
}

/** The agent's button, which says what it does beside its terminal icon. */
function agentButton(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("button")].find((one) =>
    one.textContent?.startsWith("Fill in what you own and owe"),
  );
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

/** Opens a row's form by its name; Remove is asked for from the form. */
async function choose(name: string, item: "Edit" | "Remove") {
  await click(name);
  if (item === "Remove") await click("Remove balance");
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

/** The hint under a field's label. */
function hint(label: string): string | null | undefined {
  const found = [...document.querySelectorAll("label")].find(
    (one) => one.textContent?.trim() === label,
  );
  return found?.nextElementSibling?.textContent;
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function rowOf(name: string): HTMLTableRowElement {
  const found = [...document.querySelectorAll("tbody tr")].find(
    (row) =>
      row.querySelector("td:first-child > :first-child")?.textContent === name,
  );
  if (!(found instanceof HTMLTableRowElement)) {
    throw new Error(`No row ${name} in:\n${text()}`);
  }
  return found;
}

function alert(): string | null | undefined {
  return document.querySelector('[role="alert"]')?.textContent;
}

/** Where the problem's link goes. */
function alertLink(): string | null | undefined {
  return document.querySelector('[role="alert"] a')?.getAttribute("href");
}

/** The page on the row a link names; an account with none goes on to its form. */
const linked = (account: string) =>
  `${BALANCES_SETTINGS_ROUTE}?${new URLSearchParams({ account })}`;

describe("OpeningBalances", () => {
  it("lists the recorded balances in one table, grouped into assets and liabilities", async () => {
    await renderPage([
      ...ALL,
      account(11, "Sample Home Loan", "Liabilities:Loans:Sample Home Loan", {
        opening: opening(25, -500000),
      }),
    ]);

    expect(text()).toContain("Opening balances");
    // One table: each type's group row names its amounts, then each row's
    // name, As of, figure and source. Banks and cards sit with their type.
    const recordedTable = [...host.querySelectorAll("table")].at(-1)!;
    const groups = [...recordedTable.querySelectorAll("tbody")].map((group) => {
      const [head, ...rows] = [...group.querySelectorAll("tr")];
      return [
        head.querySelector("th")?.textContent,
        head.querySelector("td")?.textContent,
        rows.map((row) =>
          [...row.querySelectorAll("td")]
            .slice(0, 4)
            .map((td) => td.firstElementChild?.textContent ?? td.textContent),
        ),
      ];
    });
    // Cash, the car loan and the gold card have none: they are listed under
    // No starting balance instead.
    expect(groups).toEqual([
      [
        "Assets",
        "Balance",
        [
          [
            "Sample Bank Savings",
            "31 Mar 2026",
            "12,000.00",
            "From account statement",
          ],
          ["EPF", "31 Mar 2026", "6,40,000.00", "Manually recorded"],
          ["PPF", "31 Mar 2026", "2,10,000.00", "Manually recorded"],
        ],
      ],
      [
        "Liabilities",
        "Owed",
        [
          [
            "Sample Card Platinum",
            "31 Mar 2026",
            "3,000.00",
            "Manually recorded",
          ],
          [
            "Sample Home Loan",
            "31 Mar 2026",
            "5,00,000.00",
            "Manually recorded",
          ],
        ],
      ],
    ]);
    expect(() => rowOf("Cash")).toThrow();
    expect(() => rowOf("Investments")).toThrow();
    expect(text()).not.toMatch(/debit|credit|equity|draft|preset/i);
    expect(
      document.querySelector('[aria-label^="Add a balance for"]'),
    ).toBeNull();
    expect(button("Record a balance by hand").getAttribute("href")).toBe(
      "/add/other",
    );

    // A row opens its form; a locked one shows why and opens its journal.
    expect(rowOf("EPF").querySelector("td button")?.textContent).toBe("EPF");
    const ppfRow = rowOf("PPF");
    expect(
      ppfRow.querySelector(
        '[aria-label="Has other transactions. Change it in its journal entry."]',
      ),
    ).not.toBeNull();
    expect(ppfRow.querySelector("td a")?.getAttribute("href")).toBe(
      "/tables/journals?filter[id][eq]=22",
    );
    expect(
      rowOf("Sample Card Platinum").querySelector(
        '[aria-label="Recorded with other accounts in one entry. Change it there."]',
      ),
    ).not.toBeNull();
  });

  it("changes a recorded balance", async () => {
    await renderPage(ALL);
    await choose("EPF", "Edit");

    expect(text()).toContain("Edit the balance for EPF");
    expect(field("Balance").value).toBe("640000.00");
    expect(field("Note").value).toBe("");
    await type(field("Balance"), "650000");
    await click("Save");

    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/opening-balances/5",
        body: { date: "2026-03-31", amount: 650000 },
      },
    ]);
    expect(document.querySelector("form")).toBeNull();
  });

  it("says a bank's balance is its first statement's", async () => {
    await renderPage(ALL);
    await choose("Sample Bank Savings", "Edit");

    expect(text()).toContain(
      "This is the balance on its first statement. If you change it, your books will no longer match the balances on its statements.",
    );
  });

  it("removes a balance once confirmed", async () => {
    await renderPage(ALL);
    await choose("EPF", "Remove");

    expect(text()).toContain("Remove the balance for EPF?");
    expect(sent).toEqual([]);
    await click("Remove");

    expect(sent).toEqual([
      { method: "DELETE", path: "/opening-balances/5", body: {} },
    ]);
  });

  it("checks the fields before sending", async () => {
    await renderPage(ALL);
    await choose("EPF", "Edit");
    await type(field("Balance"), "");
    await click("Save");
    expect(alert()).toBe("Enter the balance.");

    await type(field("Balance"), "ten");
    await click("Save");
    expect(alert()).toBe("Enter the amount as a number.");
    expect(sent).toEqual([]);
  });

  it("records the balance a link names, as held, on the default date", async () => {
    await renderPage(ALL, linked("Cash"));

    expect(rowOf("Cash").getAttribute("aria-current")).toBe("true");
    expect(text()).toContain("Add a balance for Cash");
    expect(field("As of").value).toBe("2026-03-31");
    expect(hint("As of")).toBe("When your books start.");
    await type(field("Balance"), "5,000");
    expect(hint("Balance")).toBe("");
    await click("Add balance");

    expect(sent).toEqual([
      {
        method: "POST",
        path: "/opening-balances",
        body: { account_id: 3, date: "2026-03-31", amount: 5000 },
      },
    ]);
  });

  it("records a liability's balance as owed, and reads a minus as in credit", async () => {
    await renderPage(ALL, linked("Sample Car Loan"));
    expect(hint("As of")).toBe(
      "Before its first transaction on 5 Apr 2026, or a later day you know the balance of.",
    );
    expect(field("As of").value).toBe("2026-04-04");

    await type(field("Amount owed"), "3000");
    expect(text()).not.toContain("Below zero");
    await type(field("Amount owed"), "-500");
    expect(text()).toContain("Below zero: in credit.");
    await click("Add balance");
    expect(sent.map((one) => one.body)).toEqual([
      { account_id: 7, date: "2026-04-04", amount: 500 },
    ]);
  });

  it("sends what is owed below zero, on its day or a later one", async () => {
    await renderPage(ALL, linked("Sample Car Loan"));
    await type(field("Amount owed"), "3000");
    await type(field("As of"), "2026-04-04");
    await click("Add balance");
    expect(sent.map((one) => one.body)).toMatchObject([{ amount: -3000 }]);
  });

  it("sends a balance known on a later day as typed, for the server to work back", async () => {
    await renderPage(ALL, linked("Sample Car Loan"));
    await type(field("Amount owed"), "3000");
    await type(field("As of"), "2026-04-05");
    await click("Add balance");
    expect(sent.map((one) => one.body)).toEqual([
      {
        account_id: 7,
        date: "2026-04-05",
        amount: -3000,
        description: "Owed 3,000.00 on 5 Apr 2026",
      },
    ]);
  });

  it("opens on the first statement's suggestion, and says where it is from", async () => {
    await renderPage(ALL, linked("Sample Card Gold"));

    expect(field("Amount owed").value).toBe("3000.00");
    expect(hint("Amount owed")).toBe("From its first statement's balances.");
    await type(field("Amount owed"), "2500");
    expect(hint("Amount owed")).toBe("");
  });

  it("keeps the dialog open with a refusal, and reads the list again", async () => {
    await renderPage(ALL, linked("Sample Car Loan"));
    await type(field("Amount owed"), "3000");
    const before = lists;
    refusal = {
      status: 422,
      body: {
        error:
          "Pick a day before 2026-04-01, Sample Car Loan's first transaction.",
        code: "date_not_before_first_activity",
        first_activity_date: "2026-04-01",
      },
    };
    await click("Add balance");

    expect(alert()).toBe(
      "Pick a day before 2026-04-01, Sample Car Loan's first transaction.",
    );
    expect(text()).toContain("Add a balance for Sample Car Loan");
    expect(button("Add balance").hasAttribute("disabled")).toBe(false);
    expect(lists).toBeGreaterThan(before);
  });

  // A lock refusal: the balance now has other transactions.
  const LOCKED: Answer = {
    status: 409,
    body: {
      error:
        "EPF has other transactions. Change its opening balance in its journal entry.",
      code: "account_has_entries",
      journal_id: 21,
    },
  };

  it("sends a locked balance's change to its journal entry, and stops saving", async () => {
    await renderPage(ALL);
    await choose("EPF", "Edit");
    const before = lists;
    refusal = LOCKED;
    await click("Save");

    expect(alert()).toBe(
      "EPF has other transactions. Change its opening balance in its journal entry. Journal entry",
    );
    expect(alertLink()).toBe("/tables/journals?filter[id][eq]=21");
    expect(button("Save").hasAttribute("disabled")).toBe(true);
    expect(lists).toBeGreaterThan(before);
  });

  it("sends a locked balance's removal to its journal entry, and stops removing", async () => {
    await renderPage(ALL);
    await choose("EPF", "Remove");
    const before = lists;
    refusal = LOCKED;
    await click("Remove");

    expect(text()).toContain("Remove the balance for EPF?");
    expect(alertLink()).toBe("/tables/journals?filter[id][eq]=21");
    expect(button("Remove").hasAttribute("disabled")).toBe(true);
    expect(sent).toHaveLength(1);
    expect(lists).toBeGreaterThan(before);
  });

  it("lands on a linked account by its path, at its form's URL", async () => {
    await renderPage(ALL, linked("Liabilities:Cards:Sample Card Gold"));

    const row = rowOf("Sample Card Gold");
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.className).toContain("bg-attention-bg");
    // The row stays behind the form, at the link's own `?account=`.
    expect(location()).toBe(
      `${balanceFormHref(10)}?${new URLSearchParams({
        account: "Liabilities:Cards:Sample Card Gold",
      })}`,
    );
    expect(text()).toContain("Add a balance for Sample Card Gold");
    // Opening the form didn't rebuild the page behind it: one read, and the
    // row the user was looking at is the same element.
    expect(lists).toBe(1);
    expect(document.contains(row)).toBe(true);
  });

  it("opens a linked account's form once the fresh list names it", async () => {
    // The cached list is from before the card was added.
    await renderPage(
      ALL,
      linked("Sample Card Gold"),
      ALL.filter((one) => one !== gold),
    );

    expect(rowOf("Sample Card Gold").getAttribute("aria-current")).toBe("true");
    expect(text()).toContain("Add a balance for Sample Card Gold");
  });

  it("lands on a linked account by its name, and only marks a recorded one", async () => {
    await renderPage(ALL, linked("EPF"));

    expect(rowOf("EPF").getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("form")).toBeNull();
  });

  it("opened from a link, the form closes back onto the marked row", async () => {
    await renderPage(ALL, linked("Sample Card Gold"));

    await click("Cancel");

    expect(location()).toBe(linked("Sample Card Gold"));
    expect(rowOf("Sample Card Gold").getAttribute("aria-current")).toBe("true");
  });

  it("opens a recorded balance's form from its URL, and changes it", async () => {
    await renderPage(ALL, balanceFormHref(8));

    expect(text()).toContain("Edit the balance for Sample Bank Savings");

    await act(async () => button("Save").click());
    await settle();

    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/opening-balances/8",
        body: { amount: 12000, date: "2026-03-31" },
      },
    ]);
    expect(location()).toBe(BALANCES_SETTINGS_ROUTE);
  });

  it("opens a group account's form from its URL, as a link naming it would", async () => {
    // Investments is a group account: the page lists it only for a link that
    // names it, and then in its type's table.
    await renderPage(ALL, balanceFormHref(4));

    expect(text()).toContain("Add a balance for Investments");
    expect(field("Balance")).toBeDefined();
  });

  it("says when the link's account isn't one, or isn't here", async () => {
    await renderPage(ALL, "/settings/balances/horse/edit");
    expect(text()).toContain("No account in this link");
    expect(document.querySelector("form")).toBeNull();
  });

  it("says when the link names no account in the list", async () => {
    await renderPage(ALL, balanceFormHref(999));

    expect(text()).toContain("That account isn't in your balances");
    expect(document.querySelector("form")).toBeNull();
  });

  it("points to the agent and to C1 when no balance is recorded", async () => {
    await renderPage([cash, loan, gold], undefined, undefined, [
      cash,
      loan,
      gold,
    ]);

    expect(text()).toContain("No opening balances yet");
    expect(agentButton()).toBeDefined();
    expect(button("Record a balance by hand").getAttribute("href")).toBe(
      "/add/other",
    );
    // Only the accounts with no starting balance are in a table.
    expect(document.querySelectorAll("table")).toHaveLength(1);
  });

  it("lists the accounts with no starting balance first, with their answers", async () => {
    const gone = account(12, "Sample Gold", "Assets:Sample Gold", {});
    await renderPage([...ALL, gone], undefined, undefined, [
      cash,
      loan,
      gold,
      gone,
    ]);

    const section = host.querySelector(
      'section[aria-labelledby="no-starting-balance"]',
    )!;
    expect(section.textContent).toContain(
      "Net worth is incomplete until each of these has one.",
    );
    const rows = [...section.querySelectorAll("tbody tr")].map((row) => [
      ...[...row.querySelectorAll("td")].map((td) => td.textContent),
    ]);
    // The check's order is the server's. "It started here" needs a first
    // transaction; "I don't have this" is on all but a bank or card, and
    // the delete refuses one anything is on.
    expect(rows).toEqual([
      ["Cash", "—", "It had a balanceI don't have this"],
      [
        "Sample Car Loan",
        "5 Apr 2026",
        "It had a balanceIt started hereI don't have this",
      ],
      ["Sample Card Gold", "1 Apr 2026", "It had a balanceIt started here"],
      ["Sample Gold", "—", "It had a balanceI don't have this"],
    ]);
  });

  it("records an opening of 0 the day before the first transaction for It started here", async () => {
    await renderPage(ALL, undefined, undefined, [loan]);

    await act(async () =>
      (
        host.querySelector(
          'button[aria-label="Sample Car Loan: it started here"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();

    expect(sent).toEqual([
      {
        method: "POST",
        path: "/opening-balances",
        body: {
          account_id: 7,
          date: "2026-04-04",
          amount: 0,
          description: "Started here",
        },
      },
    ]);
  });

  it("deletes an account the person doesn't have, after asking", async () => {
    const gone = account(12, "Sample Gold", "Assets:Sample Gold", {});
    await renderPage([...ALL, gone], undefined, undefined, [gone]);

    await act(async () =>
      (
        host.querySelector(
          `button[aria-label="Sample Gold: I don't have this"]`,
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(document.body.textContent).toContain("Delete Sample Gold?");
    await act(async () => button("Delete account").click());
    await settle();

    expect(sent).toEqual([
      { method: "DELETE", path: "/accounts/12", body: null },
    ]);
  });

  it("hands the accounts with no statements to the agent, with C1 beside it", async () => {
    await renderPage(ALL);

    // The agent's button first, then the quiet by-hand link, in one row.
    const agent = agentButton();
    const byHand = button("Record a balance by hand");
    expect(agent).toBeDefined();
    expect(
      agent!.compareDocumentPosition(byHand) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(byHand.className).not.toContain("bg-primary");
  });

  it("says when it can't load", async () => {
    await renderPage("refused");

    expect(text()).toContain("Couldn't load your balances");
    expect(text()).toContain("Only the owner can set up the books.");
  });
});
