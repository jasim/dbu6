// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DraftClassification, ImportPreset } from "dbu6-shared";
import { ReclassifyDrafts, reclassifyDraftsHref } from "./ReclassifyDrafts";

/*
 * Classify drafts opened from an account's Drafts tab: the account stays
 * chosen, with the mapping files its preset imports with, a run counts
 * what it categorized, by category, and links to the ones that still need
 * one, and a second run sends only those.
 */

vi.mock("@sapporta/frontend/shell", () => ({
  AppPage: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@sapporta/frontend/lookup", () => ({
  useTableLookup: () => ({}),
  LookupPicker: ({ value }: { value: number | null }) =>
    createElement("output", { "data-picked": String(value) }),
}));

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ method: string; url: URL; body: string | null }>;

const ACCOUNTS = [
  { id: 5, name: "Sample Savings" },
  { id: 7, name: "Groceries" },
  { id: 8, name: "Dining" },
];

const PRESETS: ImportPreset[] = [
  {
    name: "Sample Savings statement",
    base_account: "Sample Savings",
    custom_mappings_filenames: ["custom_mappings_sample.prompt"],
  },
  {
    name: "Other statement",
    base_account: "Dining",
    custom_mappings_filenames: ["custom_mappings_other.prompt"],
  },
];

function draft(id: number, narration: string) {
  return {
    id,
    date: "2026-09-01",
    narration,
    withdrawal: "1000",
    deposit: "0",
    account_id: null,
  };
}

const DRAFTS = [
  draft(1, "NOPII SHOP ONE"),
  draft(2, "NOPII SHOP TWO"),
  draft(3, "NOPII CAFE"),
  draft(4, "NOPII UNKNOWN"),
];

const CLASSIFIED: DraftClassification = {
  transactions: [
    {
      id: 1,
      narration: "NOPII SHOP ONE",
      account_id: 7,
      account_name: "Groceries",
    },
    {
      id: 2,
      narration: "NOPII SHOP TWO",
      account_id: 7,
      account_name: "Groceries",
    },
    { id: 3, narration: "NOPII CAFE", account_id: 8, account_name: "Dining" },
    { id: 4, narration: "NOPII UNKNOWN", account_id: null, account_name: null },
  ],
  categorization: {
    agent: "claude-code",
    sent_count: 2,
    failed_count: 0,
    error: null,
  },
  categorization_tally: {
    by_rule: 2,
    by_llm: 1,
    same_account: 0,
    uncategorized: 1,
    accounts: [
      { account_id: 7, account_name: "Groceries", count: 2 },
      { account_id: 8, account_name: "Dining", count: 1 },
    ],
  },
};

function respond(method: string, url: URL): unknown {
  if (url.pathname.endsWith("/tables/accounts")) return { data: ACCOUNTS };
  if (url.pathname.endsWith("/import-presets")) return PRESETS;
  if (url.pathname.endsWith("/tables/draft_transactions")) {
    return { data: DRAFTS };
  }
  if (
    method === "POST" &&
    url.pathname.endsWith("/draft-transactions/classify")
  ) {
    return CLASSIFIED;
  }
  throw new Error(`Unexpected request: ${method} ${url}`);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const url = new URL(
        String(request ? request.url : input),
        "http://localhost",
      );
      const body =
        typeof init?.body === "string"
          ? init.body
          : request
            ? await request.clone().text()
            : null;
      requests.push({ method, url, body });
      return Response.json(respond(method, url));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderAt(url: string) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: "/views/reclassify-drafts",
            element: createElement(ReclassifyDrafts),
          }),
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

describe("Classify drafts opened on an account", () => {
  it("keeps the account chosen, with the mapping files its preset imports with", async () => {
    await renderAt(reclassifyDraftsHref(5));

    expect(
      host.querySelector("[data-picked]")?.getAttribute("data-picked"),
    ).toBe("5");
    expect(
      requests
        .find((r) => r.url.pathname.endsWith("/tables/draft_transactions"))
        ?.url.searchParams.get("filter[base_account_id][eq]"),
    ).toBe("5");
    expect(host.querySelector<HTMLInputElement>("#mappings")?.value).toBe(
      "custom_mappings_sample.prompt",
    );
    expect(text()).toContain("Classify 4 rows");
  });

  it("counts what it categorized, by category, and links to the ones that still need one", async () => {
    await renderAt(reclassifyDraftsHref(5));

    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Classify 4 rows"),
    );
    await act(async () => button!.click());
    await settle();

    const classify = requests.find((r) => r.method === "POST");
    expect(JSON.parse(classify!.body!)).toEqual({
      ids: [1, 2, 3, 4],
      custom_mappings_filenames: ["custom_mappings_sample.prompt"],
    });
    expect(text()).toContain("Categorized3");
    expect(text()).toContain("Need a category1");
    expect(text()).not.toMatch(/your rules|Claude Code/);
    const remain = [...host.querySelectorAll("a")].find(
      (a) => a.textContent === "Categorize",
    );
    expect(remain?.getAttribute("href")).toBe(
      "/review/5/drafts?filter%5Baccount_id%5D%5Bis%5D=null",
    );
    const breakdown = [...host.querySelectorAll("dl div")].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(breakdown).toEqual([
      ["Groceries", "2"],
      ["Dining", "1"],
    ]);
  });

  it("runs again on the drafts still left, keeping the categorized ones in the table", async () => {
    await renderAt(reclassifyDraftsHref(5));
    await act(async () => classifyButton()!.click());
    await settle();

    expect(classifyButton()?.textContent).toBe("Classify 1 row");
    expect(text()).toContain("NOPII SHOP ONE");
    await act(async () => classifyButton()!.click());
    await settle();

    const runs = requests.filter((r) => r.method === "POST");
    expect(runs.map((run) => JSON.parse(run.body!).ids)).toEqual([
      [1, 2, 3, 4],
      [4],
    ]);
  });
});

function classifyButton() {
  return [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith("Classify"),
  );
}
