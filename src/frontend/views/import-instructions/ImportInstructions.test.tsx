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
  AccountInstructions,
  ImportPresetsView,
  TransactionMappingsView,
} from "../../../shared/index";
import { ImportInstructions } from "./ImportInstructions";

/*
 * Automatic transaction categorization rules: a list of the common rules and
 * each account's guidance, and
 * the chosen one beside it. An account's guidance is its files, each with
 * its text and the other accounts that share it; a missing file says so.
 */

let host: HTMLDivElement;
let root: Root;

function presetAccount(
  account_id: number,
  name: string,
  custom_mappings_filenames: string[],
) {
  return {
    account_id,
    name,
    is_credit_card: account_id === 6,
    account_identifiers: [`05050500000${account_id}`],
    custom_mappings_filenames,
    ledger_account_name: name,
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
      ],
    },
  ],
};

const INSTRUCTIONS: Record<number, AccountInstructions> = {
  5: {
    account_id: 5,
    files: [{ filename: "shared.prompt", content: "Cafes map to Dining." }],
    text: "Cafes map to Dining.",
  },
  6: {
    account_id: 6,
    files: [
      { filename: "card.prompt", content: null },
      { filename: "shared.prompt", content: "Cafes map to Dining." },
    ],
    text: "Cafes map to Dining.",
  },
};

const MAPPINGS: TransactionMappingsView = {
  state: "read",
  filename: "transaction_mappings.mjs",
  exact: [{ narration: "NOPII SHOP", account: "Groceries", in_ledger: true }],
  includes: [
    {
      account: "Dining",
      in_ledger: true,
      direction: "withdrawal",
      values: ["NOPII CAFE"],
    },
  ],
};

function respond(url: URL): unknown {
  if (url.pathname.endsWith("/import-presets")) return PRESETS;
  if (url.pathname.endsWith("/import-presets/transaction-mappings")) {
    return MAPPINGS;
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
const navLinks = () =>
  [...host.querySelectorAll("nav a")].map((a) =>
    [...a.children].map((span) => span.textContent),
  );
const files = () =>
  [...host.querySelectorAll("section ol > li")].map(
    (li) => li.textContent ?? "",
  );

describe("Automatic transaction categorization rules", () => {
  it("lists the common rules, then each account's guidance, without institutions", async () => {
    await renderAt("/categorization-rules");

    expect(host.querySelector("h1")?.textContent).toBe(
      "Automatic transaction categorization rules",
    );
    expect(navLinks()).toEqual([
      ["Common rules", "Applies to every account"],
      ["Sample Bank", "1 file"],
      ["Sample Card", "2 files"],
    ]);
    expect(text()).not.toMatch(/coding agent reads|joined|preset/);
  });

  it("shows an account's files with their text, who shares them, and which are missing", async () => {
    await renderAt("/categorization-rules?account=6");

    expect(host.querySelector("h2")?.textContent).toBe("Sample Card");
    const [card, shared] = files();
    expect(card).toContain("card.prompt");
    expect(card).toContain("Missing");
    expect(card).toContain("Not in user-config/, so the categorizer skips it.");
    expect(shared).toContain("Also used by Sample Bank");
    expect(shared).toContain("Cafes map to Dining.");
    expect(text()).not.toContain("Only this account");
  });

  it("shows the common rules, whole narrations first", async () => {
    await renderAt("/categorization-rules?show=mappings");

    expect(host.querySelector("h2")?.textContent).toBe("Common rules");
    expect(
      [...host.querySelectorAll("h3")].map((h) => h.firstChild?.textContent),
    ).toEqual(["Whole narration", "Narration contains"]);
    expect(text()).toContain("NOPII SHOP");
    expect(text()).toContain("NOPII CAFE");
  });
});
