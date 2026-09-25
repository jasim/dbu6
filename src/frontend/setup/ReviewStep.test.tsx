// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
import type { SetupStatus } from "../../shared/index";
import { ReviewStep } from "./ReviewStep";

/*
 * Step 4 (PLAN.md): the banks and cards whose first statements wait, each
 * opening in Review; "Your books are set up" once all are in and nothing
 * waits; and an empty state before anything is imported.
 */

// The frame is another screen's; the step renders inside a plain one.
vi.mock("./SetupWizard", () => ({
  SetupFrame: ({ children }: { children: ReactNode }) =>
    createElement("main", null, children),
  StepHeading: ({ title, children }: { title: string; children: ReactNode }) =>
    createElement("header", null, createElement("h2", null, title), children),
}));

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let answers: Record<string, () => Answer>;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      const key = `${method} ${url.pathname.replace(/^\/api/, "")}`;
      if (!(key in answers)) throw new Error(`No answer for ${key}`);
      const { status, body } = answers[key]();
      return Response.json(body, { status });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const ok = (body: unknown): Answer => ({ status: 200, body });

// Only where setup stands is read: Review never re-reads the statements.
function books(status: SetupStatus) {
  answers["GET /setup"] = () => ok(status);
}

async function render() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        {
          client: new QueryClient({
            defaultOptions: { queries: { retry: false } },
          }),
        },
        createElement(
          MemoryRouter,
          { initialEntries: ["/setup/review"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/setup/review",
              element: createElement(ReviewStep),
            }),
          ),
        ),
      ),
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const text = () => host.textContent ?? "";

function link(name: string): string | null {
  const found = Array.from(host.querySelectorAll("a")).find(
    (candidate) =>
      candidate.textContent?.trim() === name ||
      candidate.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No link "${name}" in: ${text()}`);
  return found.getAttribute("href");
}

describe("the review step", () => {
  it("lists the accounts with transactions to review, and opens the first", async () => {
    books({
      accounts: 72,
      statement_accounts: 4,
      imported_accounts: 3,
      drafts: 60,
      to_review: [
        { account_id: 2, name: "Sample Savings", drafts: 42, uncategorized: 4 },
        { account_id: 4, name: "Sample Card", drafts: 18, uncategorized: 0 },
      ],
    });
    await render();

    expect(host.querySelector("h2")?.textContent).toBe(
      "Review and add to your books",
    );
    const rows = Array.from(host.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ["Sample Savings", "42", "4", "Review →"],
      ["Sample Card", "18", "—", "Review →"],
    ]);
    expect(link("Review Sample Card")).toBe("/review/4");
    expect(
      Array.from(host.querySelectorAll("a"))
        .filter((a) => a.textContent === "Review Sample Savings")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/review/2"]);
    expect(text()).toContain("Optional");
    expect(
      host.querySelector('a[href="/opening-balances"]')?.textContent,
    ).toContain("Other starting balances");
    expect(text()).not.toMatch(/draft/i);
  });

  it("says the books are set up once every account is in and nothing waits", async () => {
    books({
      accounts: 72,
      statement_accounts: 1,
      imported_accounts: 1,
      drafts: 0,
      to_review: [],
    });
    await render();

    expect(text()).toContain("Your books are set up");
    expect(text()).toContain("Each month, import the new statements.");
    expect(link("Import statements")).toBe("/import");
    expect(link("Back to Home")).toBe("/");
    expect(host.querySelector("table")).toBeNull();
  });

  it("has nothing to review before a statement is imported", async () => {
    books({
      accounts: 72,
      statement_accounts: 1,
      imported_accounts: 0,
      drafts: 0,
      to_review: [],
    });
    await render();

    expect(text()).toContain("Nothing to review yet");
    expect(link("Import your first statements")).toBe("/setup/statements");
    expect(text()).not.toContain("Your books are set up");
  });

  it("says when it can't load", async () => {
    answers["GET /setup"] = () => ({
      status: 403,
      body: { error: "Only the owner can set up the books." },
    });
    await render();

    expect(text()).toContain("Couldn't load what waits to be reviewed");
  });
});
