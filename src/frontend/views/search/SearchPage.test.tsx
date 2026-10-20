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
import type { SearchJournal, SearchResults } from "../../../shared/index";
import { SearchPage } from "./SearchPage";

/*
 * The Search page: the words in the URL, the three groups of results and
 * where each one leads. What matches is the server's (app/search.test.ts).
 */

let host: HTMLDivElement;
let root: Root;
let results: SearchResults;
let requested: string[];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  requested = [];
  results = {
    words: ["sample", "market"],
    journals: [
      {
        id: 11,
        date: "2026-02-05",
        description: "NOPII sample market",
        amount: 1000,
        entries: [
          entry("Sample Savings", 0, 1000),
          entry("Groceries", 1000, 0),
        ],
      },
    ],
    drafts: [
      {
        id: 202,
        date: "2026-03-02",
        narration: "UPI-sample-market-050505",
        comment: null,
        amount: -2500,
        base_account_id: 3,
        base_account_name: "Sample Card",
        account_name: null,
      },
    ],
    accounts: [],
    truncated: { journals: false, drafts: false, accounts: false },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input instanceof Request ? input.url : input));
      return Response.json(results);
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

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
              path: "/search",
              element: createElement(SearchPage),
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

function entry(
  account: string,
  debit: number,
  credit: number,
  texts: { comment?: string; narration?: string } = {},
): SearchJournal["entries"][number] {
  return {
    account,
    debit,
    credit,
    comment: texts.comment ?? null,
    narration: texts.narration ?? null,
    reference: null,
  };
}

const text = () => host.textContent ?? "";
const links = () =>
  Array.from(host.querySelectorAll("main a")).map((a) =>
    a.getAttribute("href"),
  );

describe("the Search page", () => {
  it("asks for nothing until there are words", async () => {
    await renderAt("/search");

    expect(text()).toContain("Every word must match.");
    expect(requested).toEqual([]);
  });

  it("shows transactions and drafts, each leading to where it lives", async () => {
    await renderAt("/search?q=sample%20market");

    expect(requested[0]).toContain("/api/search?q=sample%20market");
    expect(text()).toContain("Transactions");
    expect(text()).toContain("Sample Savings → Groceries");
    // A withdrawal leaves the statement's account.
    expect(text()).toContain("Sample Card → Not categorized");
    // No accounts matched, so the group is left out.
    expect(host.querySelector("main h2")?.textContent).not.toContain(
      "Accounts",
    );
    expect(links()).toEqual([
      "/tables/journals?filter[id][eq]=11",
      "/review/3/drafts?q=sample+market",
    ]);
    expect(
      Array.from(host.querySelectorAll("mark")).map((m) => m.textContent),
    ).toContain("sample");
  });

  it("shows each matched row of a grouped journal as its own transaction", async () => {
    results = {
      ...results,
      // "x" is short, so it counts only at a word's start: not in "Expenses".
      words: ["x", "corp"],
      journals: [
        {
          id: 12,
          date: "2026-02-15",
          description: "Expenses",
          amount: 3500,
          entries: [
            entry("Office", 1000, 0, {
              comment: "NOPII X Corp sample features",
              narration: "NOPII X CORP SAMPLE FEATURES",
            }),
            entry("Software", 2000, 0, { comment: "NOPII sample store" }),
            entry("Software", 500, 0, { narration: "X CORP SAMPLE ADDON" }),
            entry("Sample Card", 0, 3500),
          ],
        },
        {
          id: 13,
          date: "2026-02-10",
          description: "X Corp sample refund",
          amount: 1000,
          entries: [entry("Sample Card", 1000, 0), entry("Office", 0, 1000)],
        },
      ],
      drafts: [],
    };
    await renderAt("/search?q=x%20corp");

    // Date, description, from, to and amount: the table's columns.
    const rows = Array.from(host.querySelectorAll("main li a")).map((row) => {
      const [date, what, from, to, amount] = Array.from(row.children);
      return [date, what!.firstElementChild, from, to, amount].map(
        (cell) => cell!.textContent,
      );
    });
    expect(rows).toEqual([
      [
        "15 Feb 2026",
        "NOPII X Corp sample features",
        "Sample Card",
        "Office",
        "1,000.00",
      ],
      [
        "15 Feb 2026",
        "X CORP SAMPLE ADDON",
        "Sample Card",
        "Software",
        "500.00",
      ],
      [
        "10 Feb 2026",
        "X Corp sample refund",
        "Office",
        "Sample Card",
        "1,000.00",
      ],
    ]);
    // A row of a grouped journal names the journal it is part of.
    expect(text().match(/Part of Expenses, 3,500\.00/g)).toHaveLength(2);
    expect(text()).toContain("Transactions 3");
  });

  it("says when nothing matches", async () => {
    results = {
      ...results,
      words: ["absent"],
      journals: [],
      drafts: [],
    };
    await renderAt("/search?q=absent");

    expect(text()).toContain("Nothing matches “absent”.");
  });

  it("puts the submitted words in the URL", async () => {
    await renderAt("/search");
    const input = host.querySelector("input")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, "  rent 050505 ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await settle();

    expect(host.querySelector("code")?.textContent).toBe(
      "/search?q=rent+050505",
    );
  });
});
