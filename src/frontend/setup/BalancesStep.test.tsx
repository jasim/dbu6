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
  OpeningBalanceAccount,
  OpeningBalances,
} from "../../shared/index";
import { BalancesStep } from "./BalancesStep";

/*
 * Step 4 on screen: what you own, what you owe, then the banks and cards;
 * one dialog per account that takes the amount the user's way up; locked
 * balances pointing to their journal entry; and a link naming an account
 * landing on its row with its dialog open.
 */

// A date the books don't give opens on today, in the workspace's zone.
vi.mock("../reports/shared", () => ({ today: () => "2026-09-25" }));

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let balances: OpeningBalances;
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
    suggested_amount: null,
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
    opening: opening(23, 12000),
  },
);
const platinum = account(
  9,
  "Sample Card Platinum",
  "Liabilities:Cards:Sample Card Platinum",
  {
    section: "statement",
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
    suggested_amount: -3000,
  },
);

const ALL = [cash, investments, epf, ppf, loan, savings, platinum, gold];

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
        sent.push({ method, path, body: text ? JSON.parse(text) : null });
        if (refusal)
          return Response.json(refusal.body, { status: refusal.status });
        return method === "POST"
          ? Response.json(
              {
                journal_id: 30,
                equity_account: { id: 1, name: "Opening Balances" },
                equity_account_created: false,
              },
              { status: 201 },
            )
          : Response.json(
              method === "PUT"
                ? { journal_id: 21 }
                : { removed_journal_id: 21 },
            );
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

async function renderStep(
  accounts: OpeningBalanceAccount[] | "refused",
  url = "/setup/balances",
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
    balances = { equity_account: null, accounts };
  }
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
          { initialEntries: [url] },
          createElement(BalancesStep),
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

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

/** Opens a row's "⋯" menu and picks an item. */
async function choose(name: string, item: "Edit" | "Remove") {
  const trigger = button(`Actions for ${name}`);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
  });
  await settle();
  await click(item);
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
    (row) => row.querySelector("td div")?.textContent === name,
  );
  if (!(found instanceof HTMLTableRowElement)) {
    throw new Error(`No row ${name} in:\n${text()}`);
  }
  return found;
}

function alert(): string | null | undefined {
  return document.querySelector('[role="alert"]')?.textContent;
}

describe("BalancesStep", () => {
  it("lists what you own, what you owe, then the banks and cards", async () => {
    await renderStep(ALL);

    expect(text()).toContain("Add your other balances");
    // Each row: its name and parent line, then As of and the figure.
    const sections = [...host.querySelectorAll("section")].map((section) => [
      section.querySelector("h3")?.textContent,
      [...section.querySelectorAll("thead th")][2].textContent,
      [...section.querySelectorAll("tbody tr")].map((row) => {
        const [name, parents] = [...row.querySelectorAll("td:first-child div")]
          .filter((div) => !div.className.includes("sm:hidden"))
          .map((div) => div.textContent);
        const [, asOf, figure] = [...row.querySelectorAll("td")].map(
          (td) => td.textContent,
        );
        return [name, parents ?? null, asOf, figure];
      }),
    ]);
    expect(sections).toEqual([
      [
        "Assets · what you own",
        "Balance",
        [
          ["Cash", null, "—", "—"],
          ["EPF", "Investments", "31 Mar 2026", "6,40,000.00"],
          ["PPF", "Investments", "31 Mar 2026", "2,10,000.00"],
        ],
      ],
      [
        "Liabilities · what you owe",
        "Owed",
        [["Sample Car Loan", "Loans", "—", "—"]],
      ],
      [
        "Banks & cards · set by each first statement",
        "Balance",
        [
          ["Sample Bank Savings", null, "31 Mar 2026", "12,000.00"],
          ["Sample Card Gold", null, "—", "—"],
          ["Sample Card Platinum", null, "31 Mar 2026", "3,000.00 owed"],
        ],
      ],
    ]);
    // A group account with no balance isn't listed.
    expect(() => rowOf("Investments")).toThrow();
    expect(text()).not.toMatch(/debit|credit|equity|draft|preset/i);

    // One action per row: Add, the menu, or the lock and its journal entry.
    expect(
      rowOf("Cash").querySelector('[aria-label="Add a balance for Cash"]'),
    ).not.toBeNull();
    expect(
      rowOf("EPF").querySelector('[aria-label="Actions for EPF"]'),
    ).not.toBeNull();
    const ppfRow = rowOf("PPF");
    expect(ppfRow.querySelector('[aria-label^="Actions"]')).toBeNull();
    expect(
      ppfRow.querySelector(
        '[aria-label="Has transactions after it. Change it in its journal entry."]',
      ),
    ).not.toBeNull();
    expect(
      ppfRow
        .querySelector('[aria-label="Open the journal entry for PPF"]')
        ?.getAttribute("href"),
    ).toBe("/tables/journals?filter[id][eq]=22");
    expect(
      rowOf("Sample Card Platinum").querySelector(
        '[aria-label="Recorded with other accounts in one entry. Change it there."]',
      ),
    ).not.toBeNull();

    expect(button("Next: Review").getAttribute("href")).toBe("/setup/review");
  });

  it("adds an asset's balance as held", async () => {
    await renderStep(ALL);
    await click("Add a balance for Cash");

    expect(text()).toContain("Add a balance for Cash");
    expect(field("As of").value).toBe("2026-03-31");
    expect(hint("As of")).toBe("When your books start.");
    await type(field("Balance"), "5,000");
    expect(hint("Balance")).toBe("What it held on 31 Mar 2026.");
    await click("Add balance");

    expect(sent).toEqual([
      {
        method: "POST",
        path: "/opening-balances",
        body: { account_id: 3, date: "2026-03-31", amount: 5000 },
      },
    ]);
    expect(document.querySelector("form")).toBeNull();
  });

  it("adds a liability's balance as owed, and reads a minus as in credit", async () => {
    await renderStep(ALL);
    await click("Add a balance for Sample Car Loan");
    expect(hint("As of")).toBe("Before its first transaction on 5 Apr 2026.");
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

  it("sends what is owed below zero", async () => {
    await renderStep(ALL);
    await click("Add a balance for Sample Car Loan");
    await type(field("Amount owed"), "3000");
    await click("Add balance");

    expect(sent.map((one) => one.body)).toMatchObject([{ amount: -3000 }]);
  });

  it("opens on the first statement's suggestion, and says where it is from", async () => {
    await renderStep(ALL);
    await click("Add a balance for Sample Card Gold");

    expect(field("Amount owed").value).toBe("3000.00");
    expect(hint("Amount owed")).toBe("From its first statement's balances.");
    await type(field("Amount owed"), "2500");
    expect(hint("Amount owed")).toBe("What you owed on 31 Mar 2026.");
  });

  it("changes a recorded balance", async () => {
    await renderStep(ALL);
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
  });

  it("says a bank's balance moves its balance checks", async () => {
    await renderStep(ALL);
    await choose("Sample Bank Savings", "Edit");

    expect(text()).toContain(
      "Set from its first statement. Changing it moves its balance checks.",
    );
  });

  it("removes a balance once confirmed", async () => {
    await renderStep(ALL);
    await choose("EPF", "Remove");

    expect(text()).toContain("Remove the balance for EPF?");
    expect(sent).toEqual([]);
    await click("Remove");

    expect(sent).toEqual([
      { method: "DELETE", path: "/opening-balances/5", body: {} },
    ]);
  });

  it("checks the fields before sending", async () => {
    await renderStep(ALL);
    await click("Add a balance for Cash");
    await click("Add balance");
    expect(alert()).toBe("Enter the balance.");

    await type(field("Balance"), "ten");
    await click("Add balance");
    expect(alert()).toBe("Enter the amount as a number.");

    await click("Cancel");
    await click("Add a balance for Sample Car Loan");
    await type(field("Amount owed"), "0");
    await type(field("As of"), "2026-04-05");
    await click("Add balance");
    expect(alert()).toBe(
      "Pick a day before 5 Apr 2026, its first transaction.",
    );
    expect(sent).toEqual([]);
  });

  it("keeps the dialog open with a refusal, and reads the list again", async () => {
    await renderStep(ALL);
    await choose("EPF", "Edit");
    const before = lists;
    refusal = {
      status: 409,
      body: {
        error:
          "EPF has transactions after its opening balance. Change it in its journal entry.",
        code: "account_has_entries",
        journal_id: 21,
      },
    };
    await click("Save");

    expect(alert()).toBe(
      "EPF has transactions after its opening balance. Change it in its journal entry.",
    );
    expect(text()).toContain("Edit the balance for EPF");
    expect(lists).toBeGreaterThan(before);
  });

  it("lands on a linked account by its path, with its dialog open", async () => {
    await renderStep(
      ALL,
      "/setup/balances?account=Liabilities%3ACards%3ASample+Card+Gold",
    );

    const row = rowOf("Sample Card Gold");
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.className).toContain("bg-attention-bg");
    expect(text()).toContain("Add a balance for Sample Card Gold");
  });

  it("lands on a linked account by its name, and only marks a recorded one", async () => {
    await renderStep(ALL, "/setup/balances?account=EPF");

    expect(rowOf("EPF").getAttribute("aria-current")).toBe("true");
    expect(document.querySelector("form")).toBeNull();
  });

  it("asks for a chart when the books have no accounts", async () => {
    await renderStep([]);

    expect(text()).toContain("Create your chart of accounts first");
    expect(button("Choose a chart").getAttribute("href")).toBe(
      "/setup/accounts",
    );
    expect(button("Next: Review")).toBeTruthy();
  });

  it("points to the Accounts page when only banks and cards are there", async () => {
    await renderStep([savings, platinum]);

    expect(text()).toContain("No cash, investment or loan accounts");
    expect(button("Accounts page").getAttribute("href")).toBe("/accounts");
    expect(rowOf("Sample Bank Savings")).toBeTruthy();
  });

  it("says when it can't load", async () => {
    await renderStep("refused");

    expect(text()).toContain("Couldn't load your accounts");
    expect(text()).toContain("Only the owner can set up the books.");
  });
});
