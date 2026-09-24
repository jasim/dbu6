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
import type {
  DraftClassification,
  ImportPresetsView,
} from "../../shared/index";
import { ReclassifyDrafts, reclassifyDraftsHref } from "./ReclassifyDrafts";

/*
 * Classify drafts opened from an account's Drafts tab: the account stays
 * chosen, with the instructions it imports with, each file shown on a tab
 * and another preset account's a choice away, a run counts
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

const PRESETS: ImportPresetsView = {
  institutions: [
    {
      id: 1,
      name: "Sample Bank",
      parsers: ["sample-bank-csv"],
      accounts: [
        {
          account_id: 8,
          name: "Sample Other",
          is_credit_card: false,
          account_identifiers: ["050505000008"],
          custom_mappings_filenames: ["custom_mappings_other.prompt"],
          ledger_account_name: "Dining",
        },
        {
          account_id: 5,
          name: "Sample Savings",
          is_credit_card: false,
          account_identifiers: ["050505000005"],
          custom_mappings_filenames: ["custom_mappings_sample.prompt"],
          ledger_account_name: "Sample Savings",
        },
      ],
    },
  ],
};

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
    failure: null,
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

// What the classify route answers; a test sets it to a failed run.
let classifyAnswer: DraftClassification;

function respond(method: string, url: URL): unknown {
  if (url.pathname.endsWith("/tables/accounts")) return { data: ACCOUNTS };
  if (url.pathname.endsWith("/import-presets")) return PRESETS;
  const file = url.pathname.match(/\/import-presets\/mapping-files\/(.+)$/);
  if (file) {
    const filename = decodeURIComponent(file[1]!);
    return {
      filename,
      content:
        filename === "custom_mappings_sample.prompt"
          ? "Sample cafes map to 'Dining'."
          : null,
    };
  }
  if (url.pathname.endsWith("/tables/draft_transactions")) {
    return { data: DRAFTS };
  }
  if (
    method === "POST" &&
    url.pathname.endsWith("/draft-transactions/classify")
  ) {
    return classifyAnswer;
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
  classifyAnswer = CLASSIFIED;
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
  it("keeps the account chosen, with the instructions it imports with, found by its id", async () => {
    await renderAt(reclassifyDraftsHref(5));

    expect(
      host.querySelector("[data-picked]")?.getAttribute("data-picked"),
    ).toBe("5");
    expect(
      requests
        .find((r) => r.url.pathname.endsWith("/tables/draft_transactions"))
        ?.url.searchParams.get("filter[base_account_id][eq]"),
    ).toBe("5");
    expect(text()).toContain("Sample Bank · Sample Savings");
    expect(text()).toContain("The instructions Sample Savings imports with.");
    expect(
      [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
    ).toEqual(["custom_mappings_sample.prompt"]);
    expect(host.querySelector("pre")?.textContent).toBe(
      "Sample cafes map to 'Dining'.",
    );
    expect(text()).toContain("Classify 4 drafts");
  });

  it("counts what it categorized, by category, and links to the ones that still need one", async () => {
    await renderAt(reclassifyDraftsHref(5));

    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Classify 4 drafts"),
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
    expect(
      host.querySelector('[aria-label="What the run did"]')?.textContent,
    ).not.toMatch(/rules|Claude Code/);
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

    expect(classifyButton()?.textContent).toBe("Classify 1 draft");
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

describe("Classify drafts when the coding agent can't be used", () => {
  const UNAVAILABLE: DraftClassification = {
    ...CLASSIFIED,
    categorization: {
      agent: "claude-code",
      sent_count: 2,
      failed_count: 2,
      error: "Claude Code didn't answer on Claude Sonnet. See Settings.",
      failure: "agent_unavailable",
    },
  };

  it("says so in a dialog that links to Settings", async () => {
    classifyAnswer = UNAVAILABLE;
    await renderAt(reclassifyDraftsHref(5));
    await act(async () => classifyButton()!.click());
    await settle();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Claude Code isn't working");
    expect(dialog?.textContent).toContain(
      "Claude Code didn't answer on Claude Sonnet. See Settings.",
    );
    const settings = [...(dialog?.querySelectorAll("a") ?? [])].find(
      (a) => a.textContent === "Open Settings",
    );
    expect(settings?.getAttribute("href")).toBe("/settings");
  });

  it("opens no dialog when only some calls failed", async () => {
    classifyAnswer = {
      ...UNAVAILABLE,
      categorization: {
        ...UNAVAILABLE.categorization,
        failed_count: 1,
        failure: "partial",
      },
    };
    await renderAt(reclassifyDraftsHref(5));
    await act(async () => classifyButton()!.click());
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(text()).toContain("Claude Code couldn't categorize some of them");
  });
});
