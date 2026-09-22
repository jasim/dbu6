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
import type {
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";
import { IncomeExpensesPage } from "./IncomeExpensesPage";

/*
 * The page's own behaviour (PLAN.md §11 P4): the period it asks the server
 * for and writes to the URL, the top rows open and the rows below opening
 * level by level with the parent's own entries as a row of their own, and
 * the empty state.
 */

vi.mock("@sapporta/frontend", () => ({ appTimeZone: () => "Asia/Kolkata" }));

let host: HTMLDivElement;
let root: Root;
let responses: unknown[];
let requests: URL[];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 16 September 2026 in Kolkata.
  vi.setSystemTime(new Date("2026-09-16T06:00:00Z"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  requests = [];
  responses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push(new URL(url, "http://localhost"));
      const next = responses.length > 1 ? responses.shift() : responses[0];
      return Response.json(next);
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function account(
  account_id: number,
  name: string,
  own: number,
  children: IncomeExpensesAccount[] = [],
): IncomeExpensesAccount {
  return {
    account_id,
    name,
    own,
    total: own + children.reduce((sum, child) => sum + child.total, 0),
    children,
  };
}

const spending = [
  // Ranked by total, as the server sends them.
  account(1, "Expenses", 0, [
    account(4, "Rent", 20000),
    account(2, "Food", 500, [account(3, "Groceries", 3000)]),
  ]),
];

function report(overrides: Partial<IncomeExpenses> = {}): IncomeExpenses {
  return {
    income: {
      total: 50000,
      accounts: [account(10, "Salary", 50000)],
    },
    spending: { total: 23500, accounts: spending },
    months: [
      { month: "2026-08", income: 25000, spending: 11500 },
      { month: "2026-09", income: 25000, spending: 12000 },
    ],
    first_month: "2025-09",
    ...overrides,
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
              path: "/reports/income-expenses",
              element: createElement(IncomeExpensesPage),
            }),
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
const location = () => host.querySelector("code")?.textContent;
const asked = (index: number) =>
  `${requests[index]?.searchParams.get("from_date")} – ${requests[index]?.searchParams.get("to_date")}`;

function button(name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent?.trim() === name ||
      candidate.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No button "${name}" in: ${text()}`);
  return found;
}

/** The toggle of an account's row, by the account's name. */
function row(name: string): HTMLButtonElement {
  const found = Array.from(
    host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ).find((candidate) => candidate.textContent?.startsWith(name));
  if (!found) throw new Error(`No row "${name}" in: ${text()}`);
  return found;
}

describe("Income and Expenses", () => {
  it("shows the last 12 months by default and a preset by name", async () => {
    responses = [report()];
    await renderAt("/reports/income-expenses");

    expect(asked(0)).toBe("2025-10-01 – 2026-09-16");
    expect(text()).toContain("1 October 2025 – 16 September 2026");
    expect(button("Last 12 months").getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("From 1 account");
    expect(text()).toContain("Across 3 accounts");
    expect(text()).toContain("53% of income");

    await act(async () => button("Last financial year").click());
    await settle();

    expect(location()).toBe(
      "/reports/income-expenses?period=last-financial-year",
    );
    expect(asked(1)).toBe("2025-04-01 – 2026-03-31");
  });

  it("lights the preset picked dates match, and narrows to a month's bar", async () => {
    responses = [report()];
    await renderAt(
      "/reports/income-expenses?from_date=2026-08-01&to_date=2026-09-16",
    );

    expect(asked(0)).toBe("2026-08-01 – 2026-09-16");
    expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(text()).toContain("Aug – Sep 2026");
    expect(text()).toContain("so far");

    await act(async () =>
      button("August 2026 · Income +₹25,000.00 · Spending −₹11,500.00").click(),
    );
    await settle();

    expect(location()).toBe(
      "/reports/income-expenses?from_date=2026-08-01&to_date=2026-08-31",
    );
    expect(button("Last month").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the top rows, then rows level by level, with a parent's own entries last", async () => {
    responses = [report()];
    await renderAt("/reports/income-expenses");

    expect(row("Expenses").getAttribute("aria-expanded")).toBe("true");
    expect(text()).toContain("Rent");
    expect(text()).toContain("Food");
    expect(text()).toContain("Collapse all");
    expect(text()).not.toContain("Groceries");

    await act(async () => row("Food").click());
    const rows = Array.from(host.querySelectorAll("li"))
      .map((li) => li.firstElementChild?.textContent ?? "")
      .filter((row) => row.includes("₹"));
    expect(rows.slice(0, 5)).toEqual([
      "Expenses100%−₹23,500.00›",
      "Rent85%−₹20,000.00›",
      "Food15%−₹3,500.00›",
      "Groceries13%−₹3,000.00›",
      "Food, not in a sub-account2%−₹500.00",
    ]);
    const history = host.querySelector<HTMLAnchorElement>(
      'a[aria-label="Account ledger for Groceries"]',
    );
    expect(history?.getAttribute("href")).toBe(
      "/reports/account-ledger?account_id=3&from_date=2025-10-01&to_date=2026-09-16",
    );

    await act(async () => button("Collapse all").click());
    expect(text()).not.toContain("Rent");
    expect(text()).not.toContain("Collapse all");

    await act(async () => row("Expenses").click());
    expect(text()).toContain("Rent");
    expect(text()).not.toContain("Groceries");
  });

  it("links the accountant's view with the same dates", async () => {
    responses = [report()];
    await renderAt("/reports/income-expenses?period=this-month");

    const link = Array.from(host.querySelectorAll("a")).find(
      (a) => a.textContent === "See these figures as an income statement",
    );
    expect(link?.getAttribute("href")).toBe(
      "/reports/income-statement?from_date=2026-09-01&to_date=2026-09-16",
    );
    // A period within one month has no chart.
    expect(text()).not.toContain("Month by month");
  });

  it("says when nothing falls in the period", async () => {
    responses = [
      report({
        income: { total: 0, accounts: [] },
        spending: { total: 0, accounts: [] },
        months: [{ month: "2025-01", income: 0, spending: 0 }],
      }),
    ];
    await renderAt(
      "/reports/income-expenses?from_date=2025-01-01&to_date=2025-01-31",
    );

    expect(text()).toContain("No income or spending in these months");
    expect(text()).toContain(
      "Nothing in your books falls between 1 Jan and 31 Jan 2025.",
    );
    expect(text()).not.toContain("Remaining");
  });

  it("shows spending higher than income in ink, not as an error", async () => {
    responses = [report({ income: { total: 0, accounts: [] } })];
    await renderAt("/reports/income-expenses");

    expect(text()).toContain("−₹23,500.00");
    expect(text()).toContain("₹23,500.00 more spent than came in");
  });
});
