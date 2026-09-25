// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
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
  AccountInstructions,
  ImportPresetsView,
  TransactionMappingsView,
} from "../../../shared/index";
import { ImportInstructions } from "./ImportInstructions";

/*
 * Automatic transaction categorization rules: three tabs in the order a
 * transaction meets them. Exact groups the whole-description rules by
 * account, Contains lists its rules in checking order, and AI shows each
 * bank or card's notes as the files have them.
 */

let host: HTMLDivElement;
let root: Root;
let location = "";
let mappings: TransactionMappingsView;

function presetAccount(
  account_id: number,
  name: string,
  custom_mappings_filenames: string[],
  inBooks = true,
) {
  return {
    account_id,
    name,
    is_credit_card: account_id === 6,
    account_identifiers: [`05050500000${account_id}`],
    custom_mappings_filenames,
    ledger_account_name: inBooks ? name : null,
  };
}

const PRESETS: ImportPresetsView = {
  institutions: [
    {
      id: 1,
      name: "Sample Bank",
      parsers: ["sample-bank-csv"],
      accounts: [
        presetAccount(5, "Sample Bank", ["shared.prompt"]),
        presetAccount(6, "Sample Card", ["card.prompt", "shared.prompt"]),
        presetAccount(7, "Sample Wallet", [], false),
        presetAccount(8, "Sample Savings", ["shared.prompt"]),
      ],
    },
  ],
};

const SHARED = "- Cafes map to 'Dining'.\n\nLeave the rest uncategorized.";

const INSTRUCTIONS: Record<number, AccountInstructions> = {
  5: {
    account_id: 5,
    files: [{ filename: "shared.prompt", content: SHARED }],
    text: SHARED,
  },
  6: {
    account_id: 6,
    files: [
      { filename: "card.prompt", content: null },
      { filename: "shared.prompt", content: SHARED },
    ],
    text: SHARED,
  },
};

const RULES: TransactionMappingsView = {
  state: "read",
  filename: "transaction_mappings.mjs",
  exact: [
    { narration: "NOPII CAFE ONE", account: "Dining", in_ledger: true },
    ...[1, 2, 3, 4, 5].map((n) => ({
      narration: `NOPII SHOP ${n}`,
      account: "Groceries",
      in_ledger: true,
    })),
    { narration: "NOPII CAFE TWO", account: "Dining", in_ledger: true },
    { narration: "NOPII OLD PAYEE", account: "Sample Gone", in_ledger: false },
  ],
  includes: [
    {
      account: "Dining",
      in_ledger: true,
      direction: "withdrawal",
      values: ["NOPII CAFE", "NOPII BISTRO"],
    },
    {
      account: "Salary",
      in_ledger: true,
      direction: "deposit",
      values: ["NOPII PAYROLL"],
    },
    {
      account: "Transfers",
      in_ledger: true,
      direction: null,
      values: ["sample-payee@okaxis"],
    },
  ],
};

function respond(url: URL): unknown {
  if (url.pathname.endsWith("/import-presets")) return PRESETS;
  if (url.pathname.endsWith("/import-presets/transaction-mappings")) {
    return mappings;
  }
  if (url.pathname.endsWith("/review/accounts")) {
    return {
      accounts: [
        {
          account_id: 5,
          path: "assets:bank:sample",
          name: "Sample Bank",
          kind: "bank",
          drafts: 3,
          uncategorised: 1,
          duplicates: 0,
          balance_checks: 0,
          failing_checks: 0,
          draft_span: null,
        },
      ],
    };
  }
  if (url.pathname.endsWith("/setup/chart-of-accounts")) {
    return {
      state: "existing",
      chart: {
        accounts: [
          { name: "Food", account_type: "expense", parent: null, note: null },
        ],
      },
    };
  }
  const instructions = url.pathname.match(
    /\/import-presets\/accounts\/(\d+)\/instructions$/,
  );
  if (instructions) return INSTRUCTIONS[Number(instructions[1])];
  throw new Error(`Unexpected request: ${url}`);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mappings = RULES;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(
        String(request ? request.url : input),
        "http://localhost",
      );
      return Response.json(respond(url));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Location() {
  const { pathname, search } = useLocation();
  location = `${pathname}${search}`;
  return null;
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderAt(url: string) {
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
          createElement(ImportInstructions),
          createElement(Location),
        ),
      ),
    );
  });
  await settle();
}

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("Nothing to click");
  await act(async () => element.click());
  await settle();
}

async function find(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error("No search box");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

const text = () => host.textContent ?? "";
const tabLists = () => [...host.querySelectorAll('[role="tablist"]')];
const tabsOf = (list: Element | undefined) =>
  [...(list?.querySelectorAll('[role="tab"]') ?? [])].map((tab) => ({
    text: tab.textContent,
    selected: tab.getAttribute("aria-selected") === "true",
  }));
const primaryTab = (label: string) =>
  [...(tabLists()[0]?.querySelectorAll('[role="tab"]') ?? [])].find((tab) =>
    tab.textContent?.startsWith(label),
  );
// A rule row's text, without the arrows and "goes to" between a rule and
// its account.
const rows = () =>
  [...host.querySelectorAll('[role="tabpanel"] li')].map((li) =>
    (li.textContent ?? "").replace(/→|goes to/g, ""),
  );

describe("Automatic transaction categorization rules", () => {
  it("shows Exact, Contains and AI in order, with their rule counts", async () => {
    await renderAt("/categorization-rules");

    expect(host.querySelector("h1")?.textContent).toBe(
      "Automatic transaction categorization rules",
    );
    expect(text()).toContain(
      "When you import a bank or card statement, these decide which account each transaction goes to.",
    );
    expect(tabsOf(tabLists()[0])).toEqual([
      { text: "Exact8", selected: true },
      { text: "Contains3", selected: false },
      { text: "AI", selected: false },
    ]);
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute("aria-labelledby")).toBe(
      primaryTab("Exact")?.id,
    );
  });

  it("keeps the tab in the URL", async () => {
    await renderAt("/categorization-rules");

    await click(primaryTab("Contains"));
    expect(location).toBe("/categorization-rules?show=contains");
    expect(primaryTab("Contains")?.getAttribute("aria-selected")).toBe("true");

    await click(primaryTab("AI"));
    expect(location).toBe("/categorization-rules?show=ai");
  });

  it("moves between the tabs with the arrow keys", async () => {
    await renderAt("/categorization-rules");

    await act(async () => {
      primaryTab("Exact")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    await settle();
    expect(location).toBe("/categorization-rules?show=ai");
    expect(document.activeElement).toBe(primaryTab("AI"));
    expect(primaryTab("Exact")?.getAttribute("tabindex")).toBe("-1");
  });

  it("opens the old link to the rules on Exact", async () => {
    await renderAt("/categorization-rules?show=mappings");
    expect(primaryTab("Exact")?.getAttribute("aria-selected")).toBe("true");
  });

  it("opens an old link to an account's guidance on its AI notes", async () => {
    await renderAt("/categorization-rules?account=6");
    expect(primaryTab("AI")?.getAttribute("aria-selected")).toBe("true");
    expect(tabsOf(tabLists()[1]).find((tab) => tab.selected)?.text).toBe(
      "Sample Card",
    );
  });

  describe("Exact", () => {
    it("opens on the first rule as an example, all of it matched", async () => {
      await renderAt("/categorization-rules?show=exact");

      expect(host.querySelector("mark")?.textContent).toBe("NOPII CAFE ONE");
      expect(text()).toContain(
        "The whole description, word for word. Checked first.",
      );
    });

    it("groups descriptions by account, most first, three before +N", async () => {
      await renderAt("/categorization-rules?show=exact");

      expect(rows()).toEqual([
        "NOPII SHOP 1·NOPII SHOP 2·NOPII SHOP 3+2Groceries5",
        "NOPII CAFE ONE·NOPII CAFE TWODining2",
        "NOPII OLD PAYEESample Gone1not in your books",
      ]);

      await click(host.querySelector('button[aria-label^="Show 2 more"]'));
      expect(rows()[0]).toContain("NOPII SHOP 5");
      expect(rows()[0]).not.toContain("+2");
    });

    it("finds descriptions and accounts, showing every match", async () => {
      await renderAt("/categorization-rules?show=exact");

      await find("shop 5");
      expect(rows()).toEqual(["NOPII SHOP 5Groceries5"]);

      await find("groceries");
      expect(rows()[0]).toContain("NOPII SHOP 4·NOPII SHOP 5");

      await find("nothing like it");
      expect(text()).toContain("Nothing matches “nothing like it”.");
    });
  });

  describe("Contains", () => {
    it("lists the rules in checking order, with their direction", async () => {
      await renderAt("/categorization-rules?show=contains");

      expect(host.querySelector("mark")?.textContent).toBe("NOPII CAFE");
      expect(rows()).toEqual([
        "1…NOPII CAFE…·…NOPII BISTRO…Diningmoney out",
        "2…NOPII PAYROLL…Salarymoney in",
        "3…sample-payee@okaxis…Transfers",
      ]);
    });

    it("keeps a rule's position when searching", async () => {
      await renderAt("/categorization-rules?show=contains");

      await find("payroll");
      expect(rows()).toEqual(["2…NOPII PAYROLL…Salarymoney in"]);
    });
  });

  describe("AI", () => {
    it("shows the notes as plain text, and who shares them", async () => {
      await renderAt("/categorization-rules?show=ai&account=5");

      expect(host.querySelector("mark")).toBeNull();
      expect(text()).toContain("POS 050505 THE BAKERS DOZEN");
      expect(tabsOf(tabLists()[1]).map((tab) => tab.text)).toEqual([
        "Sample Bank",
        "Sample Card",
        "Sample Wallet· none",
        "Sample Savings",
      ]);
      const notes = [
        ...host.querySelectorAll<HTMLElement>('[role="tabpanel"] div'),
      ].find((div) => div.children.length === 0 && div.textContent === SHARED);
      expect(notes?.className).toContain("whitespace-pre-wrap");
      expect(text()).toContain("Same notes as Sample Savings");
      expect(text()).not.toContain("shared.prompt ·");
    });

    it("labels each file when there are several, and says which is missing", async () => {
      await renderAt("/categorization-rules?show=ai&account=6");

      expect(text()).toContain(
        "card.promptNot in user-config/, so the AI doesn't get it.",
      );
      expect(text()).toContain(
        "shared.prompt · also for Sample Bank, Sample Savings",
      );
      expect(text()).not.toContain("Same notes as");
    });

    it("says when an account has no notes, or has left the books", async () => {
      await renderAt("/categorization-rules?show=ai&account=7");

      expect(text()).toContain(
        "No notes for Sample Wallet. The AI goes by your account names.",
      );
      expect(text()).toContain("Not in your books any more");
    });

    it("switches accounts in the URL", async () => {
      await renderAt("/categorization-rules?show=ai");

      const card = [
        ...(tabLists()[1]?.querySelectorAll('[role="tab"]') ?? []),
      ].find((tab) => tab.textContent === "Sample Card");
      await click(card);
      expect(location).toBe("/categorization-rules?show=ai&account=6");
    });
  });

  it("says where to edit, and links to teaching from drafts", async () => {
    await renderAt("/categorization-rules?show=ai&account=5");

    expect(text()).toContain(
      "Edit user-config/shared.prompt, or ask your coding agent.",
    );
    expect(
      [...host.querySelectorAll("a")]
        .find((a) => a.textContent === "Teach from your drafts →")
        ?.getAttribute("href"),
    ).toBe("/review/5/improve-categorization");
  });

  it("says when the rules file can't be read", async () => {
    mappings = {
      state: "unreadable",
      filename: "transaction_mappings.mjs",
      error: "SyntaxError: sample",
    };
    await renderAt("/categorization-rules");

    expect(tabsOf(tabLists()[0]).map((tab) => tab.text)).toEqual([
      "Exact",
      "Contains",
      "AI",
    ]);
    expect(text()).toContain(
      "The rules file doesn't load, so nothing is categorized until it's fixed.",
    );
    expect(text()).toContain("SyntaxError: sample");
  });
});
