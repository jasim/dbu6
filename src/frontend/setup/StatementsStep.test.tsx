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
import type {
  FirstStatementRow,
  FirstStatements,
  RecognizedFinding,
} from "../../shared/index";
import { StatementsStep } from "./StatementsStep";

/*
 * Step 3 (PLAN.md): a row per bank or card in exactly one state, from the
 * books; a read statement shows its facts and imports with one button,
 * asking only for what the statement doesn't say.
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
let posted: { path: string; body: unknown }[];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  posted = [];
  answers = { "GET /agent-handoff": () => ok({ mode: "none" }) };
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

const FINDING: RecognizedFinding = {
  outcome: "recognized",
  parser: "sample-bank-xls",
  printed_identifier: "050505000012",
  printed_institution: "SAMPLE BANK LTD",
  period: { first_date: "2026-08-01", last_date: "2026-08-31" },
  transactions: 42,
  opening: { date: "2026-07-31", amount: 12000 },
  existing_opening: null,
  parser_institution: null,
  institution: "Sample Bank",
  moves: false,
  identifier_state: "set",
  changes: [],
};

function row(
  account_id: number,
  name: string,
  state: Partial<FirstStatementRow> & Pick<FirstStatementRow, "status">,
): FirstStatementRow {
  return {
    account_id,
    name,
    kind: "bank",
    institution: "Sample Bank",
    account_identifiers: [],
    activity: { entries: 0, drafts: 0, uncategorized: 0 },
    ...state,
  } as FirstStatementRow;
}

function step(...accounts: FirstStatementRow[]): FirstStatements {
  return {
    categorizer: {
      ready: false,
      name: "no coding agent",
      reason: "No coding agent is installed.",
    },
    accounts,
  };
}

async function render() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: ["/setup/statements"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/setup/*",
              element: createElement(StatementsStep),
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

function rowOf(name: string): HTMLElement {
  const found = Array.from(host.querySelectorAll("li")).find((candidate) =>
    candidate.querySelector("h3")?.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`No row "${name}" in: ${text()}`);
  return found;
}

/** The status word in a row's header. */
function statusOf(name: string): string | null | undefined {
  return rowOf(name).querySelector("h3")?.nextElementSibling?.textContent;
}

function button(within: HTMLElement, name: string): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button "${name}" in: ${within.textContent}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

async function type(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the first statements step", () => {
  it("shows each account in its one state, and who categorizes", async () => {
    answers["GET /setup/first-statements"] = () =>
      ok(
        step(
          row(2, "Sample Savings", {
            status: "imported",
            activity: { entries: 0, drafts: 42, uncategorized: 4 },
          }),
          row(4, "Sample Card", {
            status: "read",
            kind: "card",
            finding: {
              ...FINDING,
              opening: { date: "2026-07-31", amount: -12000 },
            },
          }),
          row(6, "Other Current", { status: "needs_statement" }),
          row(8, "Third Savings", {
            status: "unreadable",
            finding: {
              outcome: "unrecognized",
              saved_path: "tmp/statement-uploads/setup-sample-8/NOPII.pdf",
              tried: ["sample-bank-xls"],
            },
          }),
          row(10, "Closed Savings", { status: "not_in_ledger" }),
        ),
      );
    await render();

    expect(host.querySelector("h2")?.textContent).toBe(
      "Import a statement for each account",
    );
    expect(text()).toContain(
      "No coding agent: transactions import without categories",
    );

    // Each row's status is a word in its header, beside the name.
    expect(
      ["Sample Savings", "Sample Card", "Other Current", "Third Savings"].map(
        statusOf,
      ),
    ).toEqual(["Imported", "Ready to import", "To do", "Can't read yet"]);

    const savings = rowOf("Sample Savings");
    expect(savings.textContent).toContain("42 to review · 4 need a category");
    expect(savings.textContent).not.toContain("✓");
    expect(savings.querySelector("a")?.getAttribute("href")).toBe("/review/2");

    const card = rowOf("Sample Card");
    expect(card.querySelector("h3")?.textContent).toBe(
      "Sample Card · Credit card",
    );
    const facts = Array.from(card.querySelectorAll("dt")).map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(facts).toEqual([
      ["Period", "1 Aug to 31 Aug 2026"],
      ["Transactions", "42"],
      ["Card number", "ending 0012✓ saved"],
      ["Amount owed on 31 Jul 2026", "12,000.00from the statement"],
    ]);
    expect(button(card, "Import 42").disabled).toBe(false);

    expect(button(rowOf("Other Current"), "Upload statement")).toBeTruthy();
    const unreadable = rowOf("Third Savings");
    expect(unreadable.textContent).toContain(
      "Your coding agent can teach dbu6 its format",
    );
    expect(button(unreadable, "Check again")).toBeTruthy();

    // Deleted from the books: it can only go, and isn't counted.
    const closed = rowOf("Closed Savings");
    expect(statusOf("Closed Savings")).toBe("Deleted from your books");
    expect(closed.querySelector("a")?.textContent).toBe(
      "Remove it in Banks & cards",
    );
    expect(closed.querySelector("a")?.getAttribute("href")).toBe(
      "/setup/banks",
    );
    expect(closed.querySelector("button")).toBeNull();

    expect(text()).toContain("3 still to import");
  });

  it("asks for a balance the statement doesn't give, and imports it as owed", async () => {
    let imported = false;
    const card = (status: "read" | "imported") =>
      row(4, "Sample Card", {
        status,
        kind: "card",
        ...(status === "read"
          ? {
              finding: {
                ...FINDING,
                opening: { date: "2026-07-31", amount: null },
              },
            }
          : { activity: { entries: 0, drafts: 42, uncategorized: 0 } }),
      });
    answers["GET /setup/first-statements"] = () =>
      ok(step(card(imported ? "imported" : "read")));
    answers["GET /setup"] = () =>
      ok({
        accounts: 5,
        statement_accounts: 1,
        imported_accounts: 1,
        drafts: 42,
      });
    answers["POST /setup/first-statement"] = () => {
      imported = true;
      return ok({ files: [], groups: [] });
    };
    await render();

    const row4 = rowOf("Sample Card");
    expect(row4.textContent).toContain(
      "Not on the statement. What you owed on 31 Jul 2026.",
    );
    expect(button(row4, "Import 42").disabled).toBe(true);
    expect(row4.textContent).toContain("Enter the balance");

    await type(
      row4.querySelector<HTMLInputElement>(
        'input[aria-label="Amount owed on 31 Jul 2026"]',
      )!,
      "12,000",
    );
    await click(button(row4, "Import 42"));

    expect(posted).toEqual([
      {
        path: "/setup/first-statement",
        body: { account_id: 4, opening_amount: -12000 },
      },
    ]);
    expect(rowOf("Sample Card").textContent).toContain("42 to review");
  });

  it("imports over a number that differs once the statement's is taken", async () => {
    answers["GET /setup/first-statements"] = () =>
      ok(
        step(
          row(2, "Sample Savings", {
            status: "read",
            account_identifiers: ["050505000099"],
            finding: { ...FINDING, identifier_state: "different" },
          }),
        ),
      );
    answers["GET /setup"] = () =>
      ok({
        accounts: 5,
        statement_accounts: 1,
        imported_accounts: 1,
        drafts: 42,
      });
    answers["POST /setup/first-statement"] = () =>
      ok({ files: [], groups: [] });
    await render();

    const savings = rowOf("Sample Savings");
    expect(savings.textContent).toContain(
      "Statement shows ending 0012; you entered ending 0099",
    );
    expect(button(savings, "Import 42").disabled).toBe(true);
    expect(savings.textContent).toContain("The numbers differ");

    await click(button(savings, "Use the statement's"));
    expect(rowOf("Sample Savings").textContent).toContain("ending 0012✓ saved");
    await click(button(rowOf("Sample Savings"), "Import 42"));

    expect(posted.map((one) => one.body)).toEqual([
      { account_id: 2, use_statement_number: true },
    ]);
  });

  it("shows what stopped an import, with another try", async () => {
    answers["GET /setup/first-statements"] = () =>
      ok(step(row(2, "Sample Savings", { status: "read", finding: FINDING })));
    answers["GET /setup"] = () =>
      ok({
        accounts: 5,
        statement_accounts: 1,
        imported_accounts: 1,
        drafts: 42,
      });
    answers["POST /setup/first-statement"] = () => ({
      status: 422,
      body: {
        error: "auto_import_files_unresolved",
        message: "1 of 1 uploaded file(s) could not be tied to an account.",
        hint: "Set up the account.",
        files: [
          {
            status: "unrecognized",
            file_name: "NOPII.xls",
            saved_path: "tmp/statement-uploads/setup-sample-2/NOPII.xls",
            candidate_parser_paths: [],
          },
        ],
      },
    });
    await render();

    await click(button(rowOf("Sample Savings"), "Import 42"));

    const savings = rowOf("Sample Savings");
    expect(savings.textContent).toContain(
      "Could not recognize this statement format",
    );
    expect(button(savings, "Try again")).toBeTruthy();
    expect(button(savings, "Use another file")).toBeTruthy();
    expect(statusOf("Sample Savings")).toBe("Not imported");
  });

  it("offers only another file when the same one would be refused again", async () => {
    answers["GET /setup/first-statements"] = () =>
      ok(step(row(2, "Sample Savings", { status: "read", finding: FINDING })));
    answers["GET /setup"] = () =>
      ok({
        accounts: 5,
        statement_accounts: 1,
        imported_accounts: 0,
        drafts: 0,
      });
    answers["POST /setup/first-statement"] = () => ({
      status: 422,
      body: {
        code: "opening_disagrees",
        error: "The balance in your books differs from the statement's.",
      },
    });
    await render();

    await click(button(rowOf("Sample Savings"), "Import 42"));

    const savings = rowOf("Sample Savings");
    expect(savings.querySelector('[role="alert"]')?.textContent).toBe(
      "The balance in your books differs from the statement's.",
    );
    expect(button(savings, "Use another file")).toBeTruthy();
    expect(() => button(savings, "Try again")).toThrow();
  });

  it("says a refusal in the server's words", async () => {
    answers["GET /setup/first-statements"] = () =>
      ok(step(row(2, "Sample Savings", { status: "read", finding: FINDING })));
    answers["GET /setup"] = () =>
      ok({
        accounts: 5,
        statement_accounts: 1,
        imported_accounts: 1,
        drafts: 42,
      });
    answers["POST /setup/first-statement"] = () => ({
      status: 409,
      body: {
        code: "already_imported",
        error: "This account has transactions already.",
      },
    });
    await render();

    await click(button(rowOf("Sample Savings"), "Import 42"));

    expect(
      rowOf("Sample Savings").querySelector('[role="alert"]')?.textContent,
    ).toBe("This account has transactions already.");
    expect(button(rowOf("Sample Savings"), "Try again")).toBeTruthy();
  });

  it("says so when an import finds nothing new, instead of starting over silently", async () => {
    let imported = false;
    answers["GET /setup/first-statements"] = () =>
      ok(
        step(
          imported
            ? row(2, "Sample Savings", { status: "needs_statement" })
            : row(2, "Sample Savings", { status: "read", finding: FINDING }),
        ),
      );
    answers["GET /setup"] = () =>
      ok({
        accounts: 5,
        statement_accounts: 1,
        imported_accounts: 0,
        drafts: 0,
      });
    answers["POST /setup/first-statement"] = () => {
      imported = true;
      return ok({ files: [], groups: [nothingNewGroup()] });
    };
    await render();

    await click(button(rowOf("Sample Savings"), "Import 42"));

    const savings = rowOf("Sample Savings");
    expect(savings.textContent).toContain(
      "Nothing new: 42 transactions already in your books.",
    );
    expect(button(savings, "Upload statement")).toBeTruthy();
  });

  it("shows the opening balance already in the books", async () => {
    answers["GET /setup/first-statements"] = () =>
      ok(
        step(
          row(2, "Sample Savings", {
            status: "read",
            finding: {
              ...FINDING,
              existing_opening: { date: "2026-06-30", amount: 9000 },
            },
          }),
        ),
      );
    await render();

    expect(rowOf("Sample Savings").textContent).toContain(
      "Balance on 30 Jun 20269,000.00already in your books",
    );
  });
});

// An account's import that found every row in the books already.
function nothingNewGroup() {
  return {
    account_id: 2,
    account_name: "Sample Savings",
    base_account: "Sample Savings",
    is_credit_card: false,
    file_names: ["NOPII.xls"],
    result: {
      hledger_journal: "",
      transaction_count: 42,
      skipped_reconciled_count: 0,
      draft_transaction_count: 0,
      duplicate_count: 42,
      draft_duplicate_count: 0,
      journal_duplicate_count: 42,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
      gpay_enriched_count: 0,
      categorization: null,
      categorization_tally: {
        by_rule: 0,
        by_llm: 0,
        same_account: 0,
        uncategorized: 0,
        accounts: [],
      },
      base_account_id: 2,
      opening_balance: 12000,
      closing_balance_from_statement: null,
      custom_statement_parser_paths: ["sample-bank-xls"],
      balance_metadata: {
        opening: { extracted: 12000, effective: 12000, source: "statement" },
        closing: { extracted: null, effective: null, source: "none" },
      },
      statement_period: { first_date: "2026-08-01", last_date: "2026-08-31" },
      reconciliation_checkpoint: { date: "2026-07-31", balance: 12000 },
    },
  };
}
