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
  OpeningBalanceAccount,
  OpeningBalances,
  StatementAccounts,
} from "../../../shared/index";
import { AddOther } from "./AddOther";

/*
 * /add/other end to end against a stubbed server: card 6 on the first run,
 * C1's account, amount and day, what it records, and where it goes next.
 * Which card the URL names is state.test.ts's.
 */

vi.mock("../../reports/shared", () => ({ today: () => "2026-09-25" }));

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let answers: Record<string, (body: unknown) => Answer>;
let sent: { key: string; body: unknown }[];
let balances: OpeningBalances;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  sent = [];
  balances = structuredClone(BALANCES);
  answers = {
    "GET /opening-balances": () => ok(balances),
    "GET /setup/statement-accounts": () => ok(STATEMENT_ACCOUNTS),
    "POST /opening-balances": (body) => {
      const { account_id, date, amount } = body as {
        account_id: number;
        date: string;
        amount: number;
      };
      const account = balances.accounts.find(
        (one) => one.account_id === account_id,
      )!;
      account.opening = {
        journal_id: 50509,
        date,
        amount,
        description: "Opening balance",
        locked: null,
      };
      return {
        status: 201,
        body: {
          journal_id: 50509,
          equity_account: { id: 9, name: "Opening Balances" },
          equity_account_created: false,
        },
      };
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      const path = url.pathname.replace(/^\/api/, "");
      const key = `${method} ${path}`;
      const raw = request ? await request.clone().text() : init?.body;
      const body =
        typeof raw === "string" && raw !== "" ? JSON.parse(raw) : null;
      if (method !== "GET") sent.push({ key, body });
      if (!(key in answers)) throw new Error(`No answer for ${key}`);
      const answer = answers[key](body);
      return Response.json(answer.body, { status: answer.status });
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const ok = (body: unknown): Answer => ({ status: 200, body });

function account(
  over: Partial<OpeningBalanceAccount> &
    Pick<OpeningBalanceAccount, "account_id" | "name">,
): OpeningBalanceAccount {
  return {
    path: `Assets:${over.name}`,
    account_type: "Asset",
    section: "own",
    first_activity_date: null,
    default_date: "2025-12-31",
    suggested_amount: null,
    opening: null,
    ...over,
  };
}

const BALANCES: OpeningBalances = {
  equity_account: { id: 9, name: "Opening Balances" },
  accounts: [
    account({ account_id: 2, name: "Cash" }),
    account({
      account_id: 3,
      name: "Sample Car Loan",
      path: "Liabilities:Loans:Sample Car Loan",
      account_type: "Liability",
      section: "owe",
      first_activity_date: "2026-04-10",
      default_date: "2026-04-09",
    }),
    account({
      account_id: 4,
      name: "Sample Savings",
      path: "Assets:Bank Accounts:Sample Savings",
      section: "statement",
      opening: {
        journal_id: 50501,
        date: "2025-12-31",
        amount: 10000,
        description: "Opening balance",
        locked: "has_entries",
      },
    }),
  ],
};

const STATEMENT_ACCOUNTS: StatementAccounts = {
  institutions: [{ name: "Sample Bank", parsers: ["sample-bank-xls"] }],
  accounts: [
    {
      account_id: 4,
      name: "Sample Savings",
      kind: "bank",
      institution: "Sample Bank",
      account_identifiers: ["050505000012"],
      parent: { id: 1, name: "Bank Accounts" },
      in_ledger: true,
      entries: 0,
      drafts: 40,
    },
  ],
  parents: {
    bank: [{ id: 1, name: "Bank Accounts", path: "Assets:Bank Accounts" }],
    card: [],
  },
  default_parents: { bank: 1, card: null },
  mixed_parents: { bank: false, card: false },
  unlisted: [],
  account_names: ["Assets", "Bank Accounts", "Sample Savings"],
};

function Where() {
  const location = useLocation();
  return createElement(
    "p",
    { "data-where": "" },
    `${location.pathname}${location.search}`,
  );
}

async function render(entry: string) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: [entry] },
          createElement(Where),
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: "/add/other",
              element: createElement(AddOther),
            }),
            createElement(Route, { path: "*", element: null }),
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

const title = () => host.querySelector("h1")?.textContent ?? "";
const text = () => host.textContent ?? "";
const where = () => host.querySelector("[data-where]")?.textContent ?? "";
const alert = () => host.querySelector('[role="alert"]')?.textContent ?? null;

function button(label: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>("button, a")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button "${label}" in: ${text()}`);
  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

/** The field a label names, or null. */
function field(label: string): HTMLInputElement | null {
  const found = [...host.querySelectorAll("label")].find(
    (el) => el.textContent === label,
  );
  return found
    ? (document.getElementById(found.htmlFor) as HTMLInputElement | null)
    : null;
}

async function type(label: string, value: string) {
  const input = field(label);
  if (!input) throw new Error(`No field "${label}" in: ${text()}`);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pick(name: string) {
  await act(async () =>
    host.querySelector<HTMLElement>('[aria-label="Show the choices"]')!.click(),
  );
  await settle();
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((el) => el.textContent?.startsWith(name));
  if (!option) throw new Error(`No choice "${name}"`);
  await act(async () => option.click());
  await settle();
}

describe("card 6, first run", () => {
  it("asks for cash, a deposit or a loan, and hands off to Review", async () => {
    await render("/add/other?run=setup");
    expect(title()).toBe("Cash, a deposit, a loan?");
    expect(text()).toContain("Set up your books");
    expect(text()).toContain("Banks & cards · 1 added");
    expect(button("That's all").getAttribute("href")).toBe(
      "/review?imported=1&run=setup",
    );
    expect(button("Add one").getAttribute("href")).toBe(
      "/add/other?run=setup&record=1",
    );
  });

  it("names what the books have recorded", async () => {
    balances.accounts[0].opening = {
      journal_id: 50509,
      date: "2025-12-31",
      amount: 1000,
      description: "Opening balance",
      locked: null,
    };
    await render("/add/other?run=setup");
    expect(title()).toBe("Cash, a deposit, a loan?");
    expect(text()).toContain("✓ Cash recorded");
  });
});

describe("C1", () => {
  it("offers the chart's own and owe accounts with no opening, and links to the Accounts page", async () => {
    await render("/add/other?run=setup&record=1");
    expect(title()).toBe("Which account?");
    expect(button("Record balance").hasAttribute("disabled")).toBe(true);
    expect(button("Back").getAttribute("href")).toBe("/add/other?run=setup");
    expect(button("Accounts page").getAttribute("href")).toBe("/accounts");
    // A new tab, so the run isn't lost.
    expect(button("Accounts page").getAttribute("target")).toBe("_blank");
    // No amount until the account is picked.
    expect(field("Balance")).toBeNull();

    await act(async () =>
      host
        .querySelector<HTMLElement>('[aria-label="Show the choices"]')!
        .click(),
    );
    await settle();
    const offered = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].map((el) => el.textContent);
    expect(offered).toEqual([
      "CashAssets:Cash",
      "Sample Car LoanLiabilities:Loans:Sample Car Loan",
    ]);
  });

  it("records what an asset held, on its default day, and comes back to card 6", async () => {
    await render("/add/other?run=setup&record=1");
    await pick("Cash");
    expect(title()).toBe("What did Cash hold?");
    expect(field("As of")?.value).toBe("2025-12-31");
    expect(text()).toContain("When your books start.");

    await type("Balance", "2,500");
    await click("Record balance");
    expect(sent).toEqual([
      {
        key: "POST /opening-balances",
        body: { account_id: 2, date: "2025-12-31", amount: 2500 },
      },
    ]);
    expect(where()).toBe("/add/other?run=setup");
    expect(title()).toBe("Cash, a deposit, a loan?");
    expect(text()).toContain("✓ Cash recorded");
  });

  it("records what the user owed as negative, and goes Home later", async () => {
    await render("/add/other");
    expect(text()).toContain("Add a balance");
    expect(() => button("Back")).toThrow();
    await pick("Sample Car Loan");
    expect(title()).toBe("What did you owe on Sample Car Loan?");
    expect(field("As of")?.value).toBe("2026-04-09");
    expect(text()).toContain("Before its first transaction on");

    await type("Amount owed", "350000");
    await click("Record balance");
    expect(sent[0].body).toEqual({
      account_id: 3,
      date: "2026-04-09",
      amount: -350000,
    });
    expect(where()).toBe("/");
  });

  it("defaults to today when the books have no opening yet", async () => {
    balances.accounts = [
      account({ account_id: 2, name: "Cash", default_date: null }),
    ];
    await render("/add/other");
    // The one account left is picked already.
    expect(title()).toBe("What did Cash hold?");
    expect(field("As of")?.value).toBe("2026-09-25");
  });

  it("says what's wrong before sending, and the server's refusal in its words", async () => {
    await render("/add/other");
    await pick("Sample Car Loan");
    await click("Record balance");
    expect(alert()).toBe("Enter the amount owed.");
    expect(sent).toEqual([]);

    answers["POST /opening-balances"] = () => ({
      status: 422,
      body: {
        code: "already_recorded",
        error:
          "Sample Car Loan already has an opening balance, from 9 Apr 2026.",
      },
    });
    await type("Amount owed", "1000");
    await click("Record balance");
    expect(alert()).toBe(
      "Sample Car Loan already has an opening balance, from 9 Apr 2026.",
    );
    expect(where()).toBe("/add/other");
  });

  it("says so plainly when no account is left, with That's all on the first run", async () => {
    balances.accounts = balances.accounts.filter(
      (one) => one.section === "statement",
    );
    await render("/add/other?run=setup&record=1");
    expect(title()).toBe("Your chart has no cash, deposit or loan accounts");
    expect(button("Accounts page").getAttribute("href")).toBe("/accounts");
    // A new tab, so the run isn't lost.
    expect(button("Accounts page").getAttribute("target")).toBe("_blank");
    expect(button("That's all").getAttribute("href")).toBe(
      "/review?imported=1&run=setup",
    );
  });

  it("goes Home when none is left later", async () => {
    for (const one of balances.accounts) {
      one.opening ??= {
        journal_id: 50509,
        date: "2025-12-31",
        amount: 1000,
        description: "Opening balance",
        locked: null,
      };
    }
    await render("/add/other");
    expect(title()).toBe("Every account in your chart has its balance");
    expect(button("Done").getAttribute("href")).toBe("/");
  });
});
