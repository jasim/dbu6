// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
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
  ChartAccount,
  ChartOfAccounts,
  ChartSuggester,
  ChartSuggestion,
} from "../../shared/index";
import { registerTypeScale } from "../type-scale";
import { ChartStep } from "./ChartStep";

/*
 * Step 1 (PLAN.md): a new system picks the standard chart or describes its
 * money, ticks through two-level cards and creates the ticked accounts; an
 * existing system sees its counts and moves on.
 */

// The frame is another screen's; the step renders inside a plain one.
vi.mock("./SetupWizard", () => ({
  SetupFrame: ({ children }: { children: ReactNode }) =>
    createElement("main", null, children),
  StepHeading: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("header", null, createElement("h2", null, title), children),
}));

let host: HTMLDivElement;
let root: Root;
let answers: Record<string, unknown>;
// A status other than 200, by the answer's key.
let statuses: Record<string, number>;
let posted: { path: string; body: unknown }[];

beforeAll(() => {
  // As startDbu6Frontend does, so class merging here is the app's.
  registerTypeScale();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posted = [];
  answers = {};
  statuses = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      const path = url.pathname.replace(/^\/api/, "");
      if (method === "POST") {
        const raw = request ? await request.text() : String(init?.body ?? "");
        posted.push({ path, body: JSON.parse(raw) });
      }
      const key = `${method} ${path}`;
      if (!(key in answers)) throw new Error(`No answer for ${key}`);
      return Response.json(answers[key], { status: statuses[key] ?? 200 });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const account = (
  name: string,
  account_type: ChartAccount["account_type"],
  parent: string | null = null,
  note: string | null = null,
): ChartAccount => ({ name, account_type, parent, note });

const STARTER: ChartAccount[] = [
  account("Assets", "Asset"),
  account("Bank Accounts", "Asset", "Assets", "Each bank account goes here."),
  account("Investments", "Asset", "Assets"),
  account("Sample Fund", "Asset", "Investments"),
  account("Sample Stocks", "Asset", "Investments"),
  account("Liabilities", "Liability"),
  account("Equity", "Equity"),
  account("Opening Balances", "Equity", "Equity"),
  account("Income", "Revenue"),
  account("Expenses", "Expense"),
  account("Food", "Expense", "Expenses"),
  account("Children", "Expense", "Expenses"),
];

const NEW_CHART: ChartOfAccounts = {
  state: "new",
  starter: { accounts: STARTER },
  unticked: ["Children"],
};

const READY: ChartSuggester = { ready: true, name: "Sample Agent" };

function Where() {
  return createElement("code", null, useLocation().pathname);
}

async function render() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: ["/setup/accounts"] },
          createElement(Where),
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/setup/*",
              element: createElement(ChartStep),
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
const where = () => host.querySelector("code")?.textContent;

function button(name: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button "${name}" in: ${text()}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

/** The box of an account's row, by the account's name. */
function box(name: string): HTMLElement {
  const label = Array.from(host.querySelectorAll("label")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  const found =
    label?.parentElement?.querySelector<HTMLElement>('[role="checkbox"]');
  if (!found) throw new Error(`No box for "${name}" in: ${text()}`);
  return found;
}

async function type(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("a new system's chart", () => {
  it("shows two levels per type, folds deeper ones, and creates what is ticked", async () => {
    answers = {
      "GET /setup/chart-of-accounts": NEW_CHART,
      "GET /setup/chart-of-accounts/suggest": READY,
      "POST /setup/chart-of-accounts": { ok: true },
    };
    await render();

    expect(host.querySelector("h2")?.textContent).toBe(
      "Choose your chart of accounts",
    );
    const headings = Array.from(host.querySelectorAll("h3")).map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual([
      "Assets · what you own",
      "Liabilities · what you owe",
      "Equity · where your books start",
      "Income · money coming in",
      "Expenses · money going out",
    ]);
    // Children starts unticked; the funds fold under Investments.
    expect(text()).toContain("11 of 12 ticked");
    // An unticked name keeps its size beside the meta ink.
    const children = Array.from(host.querySelectorAll("label span")).find(
      (one) => one.textContent === "Children",
    );
    expect(children?.className).toContain("text-row");
    expect(children?.className).toContain("text-ink-meta");
    expect(text()).not.toContain("Sample Fund");
    await click(button("▸ 2 more"));
    expect(text()).toContain("Sample Fund");
    // A note is a tooltip, not a line.
    expect(text()).not.toContain("Each bank account goes here.");

    await click(box("Investments"));
    expect(text()).toContain("8 of 12 ticked");
    await click(button("Create 8 accounts"));

    const created = posted.find(
      (one) => one.path === "/setup/chart-of-accounts",
    )?.body as { accounts: ChartAccount[] };
    expect(created.accounts.map((a) => a.name)).toEqual([
      "Assets",
      "Bank Accounts",
      "Liabilities",
      "Equity",
      "Opening Balances",
      "Income",
      "Expenses",
      "Food",
    ]);
    expect(where()).toBe("/setup/banks");
  });

  it("drops a refusal once the chart or its ticks change", async () => {
    answers = {
      "GET /setup/chart-of-accounts": NEW_CHART,
      "GET /setup/chart-of-accounts/suggest": READY,
      "POST /setup/chart-of-accounts": {
        error: "The chart can't be created: NOPII problem.",
        code: "invalid_chart",
        problems: ["NOPII problem."],
      },
    };
    statuses = { "POST /setup/chart-of-accounts": 422 };
    await render();

    await click(button("Create 11 accounts"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "NOPII problem.",
    );
    await click(box("Food"));
    expect(host.querySelector('[role="alert"]')).toBeNull();

    await click(button("Create 10 accounts"));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await click(button("✦ Describe your money"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("says why describing is off when no agent is ready", async () => {
    answers = {
      "GET /setup/chart-of-accounts": NEW_CHART,
      "GET /setup/chart-of-accounts/suggest": {
        ready: false,
        name: "Sample Agent",
        reason: "No coding agent is set up.",
      } satisfies ChartSuggester,
    };
    await render();

    expect(button("✦ Describe your money").disabled).toBe(true);
    expect(text()).toContain("No coding agent is set up. Settings");
    expect(host.querySelector("textarea")).toBeNull();
    expect(button("Create 11 accounts").disabled).toBe(false);
  });

  it("replaces the chart with the agent's proposal, and goes back", async () => {
    const suggestion: ChartSuggestion = {
      proposal: {
        accounts: [
          account("Assets", "Asset"),
          account("Liabilities", "Liability"),
          account("Equity", "Equity"),
          account("Opening Balances", "Equity", "Equity"),
          account("Income", "Revenue"),
          account("Freelance", "Revenue", "Income", "Sample client work."),
          account("Expenses", "Expense"),
        ],
      },
      notes: ["Opening Balances was added."],
    };
    answers = {
      "GET /setup/chart-of-accounts": NEW_CHART,
      "GET /setup/chart-of-accounts/suggest": READY,
      "POST /setup/chart-of-accounts/suggest": suggestion,
    };
    await render();

    await click(button("✦ Describe your money"));
    expect(text()).toContain("✦ Sample Agent proposes accounts that fit.");
    await type(host.querySelector("textarea")!, "Sample freelance work.");
    await click(button("Propose accounts"));

    const asked = posted.find(
      (one) => one.path === "/setup/chart-of-accounts/suggest",
    )?.body as { description: string; current: ChartAccount[] };
    expect(asked.description).toBe("Sample freelance work.");
    expect(asked.current).toHaveLength(11);
    expect(text()).toContain("Freelance");
    expect(text()).toContain("1 adjustment");
    expect(text()).toContain("7 of 7 ticked");

    await click(button("Back to the standard chart"));
    expect(text()).not.toContain("Freelance");
    expect(text()).toContain("11 of 12 ticked");
  });
});

describe("an existing system's chart", () => {
  it("counts the accounts per type and moves on to banks", async () => {
    answers = {
      "GET /setup/chart-of-accounts": {
        state: "existing",
        chart: { accounts: STARTER },
      } satisfies ChartOfAccounts,
    };
    await render();

    expect(host.querySelector("h2")?.textContent).toBe(
      "Your chart of accounts",
    );
    expect(text()).toContain("Your books already have 12 accounts.");
    const counts = Array.from(host.querySelectorAll("dl > div")).map(
      (fact) => fact.textContent,
    );
    expect(counts).toEqual([
      "Assets5",
      "Liabilities1",
      "Equity2",
      "Income1",
      "Expenses3",
    ]);
    expect(host.querySelector('a[href="/accounts"]')?.textContent).toBe(
      "Accounts page",
    );
    expect(host.querySelector('a[href="/setup/banks"]')?.textContent).toBe(
      "Next: Banks & cards",
    );
  });
});
