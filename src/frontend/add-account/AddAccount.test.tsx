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
  AddAccountCandidate,
  AddAccountFile,
  AddAccountReading,
  StatementAccounts,
} from "../../shared/index";
import { carriedFiles } from "../views/import-statements/files";
import { AddAccount } from "./AddAccount";

/*
 * /add end to end against a stubbed server: drop, read, the cards the read
 * leads to, and the add. The card choice itself is state.test.ts's; here,
 * what each card sends and where the flow goes next.
 */

vi.mock("../reports/shared", () => ({ today: () => "2026-09-25" }));

type Answer = { status: number; body: unknown };

let host: HTMLDivElement;
let root: Root;
let answers: Record<string, (form: FormData | null) => Answer>;
let sent: { path: string; files: string[]; fields: Record<string, string> }[];
let books: StatementAccounts;

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
  books = structuredClone(DATA);
  answers = {
    "GET /agent-handoff": () => ok({ mode: "none" }),
    "GET /setup/statement-accounts": () => ok(books),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), "http://localhost");
      const method = request?.method ?? init?.method ?? "GET";
      const path = url.pathname.replace(/^\/api/, "");
      const form = init?.body instanceof FormData ? init.body : null;
      if (form) {
        const fields: Record<string, string> = {};
        for (const [name, value] of form.entries()) {
          if (typeof value === "string") fields[name] = value;
        }
        sent.push({
          path,
          files: form.getAll("files").map((file) => (file as File).name),
          fields,
        });
      }
      const key = `${method} ${path}`;
      if (!(key in answers)) throw new Error(`No answer for ${key}`);
      const { status, body } = answers[key](form);
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

const DATA: StatementAccounts = {
  institutions: [{ name: "Sample Bank", parsers: ["sample-bank-xls"] }],
  accounts: [],
  parents: {
    bank: [{ id: 1, name: "Bank Accounts", path: "Assets:Bank Accounts" }],
    card: [{ id: 2, name: "Credit Cards", path: "Liabilities:Credit Cards" }],
  },
  default_parents: { bank: 1, card: 2 },
  mixed_parents: { bank: false, card: false },
  unlisted: [],
  account_names: ["Assets", "Bank Accounts", "Liabilities", "Credit Cards"],
};

/** The books once the add made `name`, with drafts. */
function withAdded(account_id: number, name: string) {
  books.accounts.push({
    account_id,
    name,
    kind: "bank",
    institution: "Sample Bank",
    account_identifiers: ["050505000012"],
    parent: { id: 1, name: "Bank Accounts" },
    in_ledger: true,
    entries: 0,
    drafts: 40,
  });
  return ok({ account_id, account_name: name, drafts: 40 });
}

function candidate(
  overrides: Partial<AddAccountCandidate> = {},
): AddAccountCandidate {
  return {
    key: "savings",
    status: "new",
    account: null,
    institution: "Sample Bank",
    institution_listed: true,
    kind: "bank",
    identifier: "050505000012",
    parsers: ["sample-bank-xls"],
    file_names: ["jan.xls", "feb.xls"],
    period: { first_date: "2025-01-01", last_date: "2025-02-28" },
    transactions: 40,
    opening: { date: "2024-12-31", amount: 10000 },
    needs_opening: false,
    opening_refusal: null,
    refusal: null,
    ...overrides,
  };
}

function reading(
  accounts: AddAccountCandidate[],
  unreadable: AddAccountFile[] = [],
): AddAccountReading {
  return {
    files: [
      ...accounts.flatMap((account) =>
        account.file_names.map((file_name) => ({
          status: "read" as const,
          file_name,
          account_key: account.key,
          parser: account.parsers[0],
          period: account.period,
          transactions: 20,
          saved_path: null,
        })),
      ),
      ...unreadable,
    ],
    accounts,
    categorizer: { ready: true, name: "Sample Agent" },
  };
}

/** Where the router is, whatever the route. */
function Where() {
  const location = useLocation();
  return createElement(
    "p",
    { "data-where": "" },
    `${location.pathname}${location.search}`,
    ` files:${carriedFiles(location.state)
      .map((file) => file.name)
      .join(",")}`,
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
              path: "/add",
              element: createElement(AddAccount),
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

function button(label: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>("button, a")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No button "${label}" in: ${text()}`);
  return found;
}

/** The card's primary: its one filled button. */
function primary(): string[] {
  return [...host.querySelectorAll<HTMLElement>("section button, section a")]
    .filter((el) => el.className.includes("bg-primary "))
    .map((el) => el.textContent?.trim() ?? "");
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

async function choose(label: string) {
  const radio = [...host.querySelectorAll("label")]
    .find((el) => el.textContent?.trim() === label)
    ?.querySelector("input");
  if (!radio) throw new Error(`No choice "${label}" in: ${text()}`);
  await act(async () => radio.click());
}

async function drop(...names: string[]) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error(`No file input in: ${text()}`);
  const files = names.map((name) => new File(["sample"], name));
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

const nameField = () => field("Name")!;

describe("adding a bank or card", () => {
  it("reads the drop, confirms it as facts, adds it and opens its drafts", async () => {
    answers["POST /add-account/read"] = () => ok(reading([candidate()]));
    answers["POST /add-account/add"] = () => withAdded(12, "Sample Savings");
    await render("/add?from=2025-01");

    expect(title()).toBe("Drop this account's statements");
    expect(text()).toContain("Adding a bank or card");
    await drop("jan.xls", "feb.xls");

    expect(title()).toBe("Sample Bank · ending 0012");
    expect(text()).toContain("Jan – Feb 2025 · 40 transactions");
    expect(text()).toContain("✓ Balances add up");
    expect(text()).toContain("Categorized by Sample Agent");
    // A bank dbu6 knows: no bank field.
    expect(
      [...host.querySelectorAll("label")].map((label) => label.textContent),
    ).not.toContain("Bank");
    expect(nameField().value).toBe("Sample Savings");

    await click("Add to books");
    expect(sent.map((one) => one.path)).toEqual([
      "/add-account/read",
      "/add-account/add",
    ]);
    expect(sent[1]).toEqual({
      path: "/add-account/add",
      files: ["jan.xls", "feb.xls"],
      fields: { name: "Sample Savings", parent_id: "1" },
    });
    expect(where()).toBe("/review/12/drafts?imported=1 files:");
  });

  it("shows the add's refusal under the button, and reads the files again", async () => {
    let reads = 0;
    answers["POST /add-account/read"] = () =>
      ok(
        reading([
          ++reads === 1
            ? candidate()
            : // The refusal left the account set up, with no transactions.
              candidate({
                status: "empty",
                account: { id: 12, name: "Sample Savings" },
              }),
        ]),
      );
    answers["POST /add-account/add"] = () => ({
      status: 422,
      body: {
        error: "The categorizer stopped: sample reason.",
        code: "import_refused",
      },
    });
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");
    await click("Add to books");

    expect(sent.map((one) => one.path)).toEqual([
      "/add-account/read",
      "/add-account/add",
      "/add-account/read",
    ]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "The categorizer stopped: sample reason.",
    );
    // Now the account in the books: nothing left to fill.
    expect(title()).toBe("Sample Savings");
    expect(nameField()).toBeNull();
  });

  it("runs the first run: how far back, add, then another or that's all", async () => {
    answers["POST /add-account/read"] = () => ok(reading([candidate()]));
    answers["POST /add-account/add"] = () => withAdded(12, "Sample Savings");
    await render("/add?run=setup");

    expect(title()).toBe("How far back should your books go?");
    expect(button("Continue").hasAttribute("disabled")).toBe(true);
    await act(async () =>
      host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click(),
    );
    expect(text()).toContain(
      "Download your statements from Jan 2026 to now, then come back.",
    );
    await click("Continue");
    expect(title()).toBe("Drop this account's statements");

    await drop("jan.xls", "feb.xls");
    await click("Add to books");
    expect(where()).toBe("/add?run=setup&from=2026-01&added=12 files:");
    expect(title()).toBe("Sample Savings added.");
    expect(text()).toContain("Setting up your books · 1 account added");
    expect(button("That's all").getAttribute("href")).toBe(
      "/add/other?run=setup",
    );

    await click("Add another bank or card");
    expect(where()).toBe("/add?run=setup files:");
    expect(title()).toBe("How far back should your books go?");
    // The answer before is carried as the preselected one.
    const radios = host.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    expect(radios[1].checked).toBe(true);
    expect(host.querySelector("select")?.value).toBe("2026-01");
  });

  it("shows Another? again on a reload of ?added", async () => {
    books.accounts.push({
      account_id: 12,
      name: "Sample Savings",
      kind: "bank",
      institution: "Sample Bank",
      account_identifiers: [],
      parent: null,
      in_ledger: true,
      entries: 0,
      drafts: 40,
    });
    await render("/add?run=setup&from=2025-01&added=12");
    expect(title()).toBe("Sample Savings added.");
  });

  it("asks a later add about this bank or card", async () => {
    await render("/add");
    expect(title()).toBe(
      "How far back do you want this bank or card's transactions?",
    );
  });

  it("asks for the balance a statement doesn't print, and sends it", async () => {
    answers["POST /add-account/read"] = () =>
      ok(
        reading([
          candidate({
            kind: "card",
            institution: "Sample Card Co",
            opening: { date: "2024-12-31", amount: null },
            needs_opening: true,
          }),
        ]),
      );
    answers["POST /add-account/add"] = () =>
      withAdded(13, "Sample Card Co Credit Card");
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");

    expect(title()).toBe(
      "What did you owe on Sample Card Co Credit Card on 31 Dec 2024?",
    );
    expect(button("Continue").hasAttribute("disabled")).toBe(true);
    await type(host.querySelector("input")!, "2,500");
    await click("Continue");

    expect(text()).toContain("Starts at 2,500.00 owed on 31 Dec 2024");
    await click("Add to books");
    expect(sent[1].fields).toEqual({
      opening_amount: "-2500",
      name: "Sample Card Co Credit Card",
      parent_id: "2",
    });
  });

  it("asks bank or card when the statements print no number, and sends it", async () => {
    answers["POST /add-account/read"] = () =>
      ok(reading([candidate({ kind: null, identifier: null })]));
    answers["POST /add-account/add"] = () =>
      withAdded(13, "Sample Credit Card");
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");

    expect(title()).toBe("Is Sample Bank a bank account or a credit card?");
    expect(primary()).toEqual(["Continue"]);
    await choose("Credit card");
    await click("Continue");
    expect(title()).toBe("Sample Bank");
    expect(nameField().value).toBe("Sample Credit Card");
    await click("Add to books");
    expect(sent[1].fields).toMatchObject({ kind: "card" });
  });

  it("asks for the bank dbu6 hasn't met, prefilled from the statement", async () => {
    answers["POST /add-account/read"] = () =>
      ok(
        reading([
          candidate({
            institution: "Other Sample Bank",
            institution_listed: false,
          }),
        ]),
      );
    answers["POST /add-account/add"] = () =>
      withAdded(14, "Other Sample Savings");
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");

    expect(field("Bank")?.value).toBe("Other Sample Bank");
    expect(nameField().value).toBe("Other Sample Savings");
    await click("Add to books");
    expect(sent[1].fields).toEqual({
      institution: "Other Sample Bank",
      name: "Other Sample Savings",
      parent_id: "1",
    });
  });

  it("takes one account per drop, starting with the first", async () => {
    const savings = candidate();
    const card = candidate({
      key: "card",
      kind: "card",
      institution: "Sample Card Co",
      identifier: "050505XXXXXX0505",
      file_names: ["card.pdf"],
    });
    // The read lists the files in the order they were dropped.
    const both = reading([savings, card]);
    const [jan, feb, pdf] = both.files;
    both.files = [jan, pdf, feb];
    answers["POST /add-account/read"] = (form) =>
      form!.getAll("files").length === 3 ? ok(both) : ok(reading([savings]));
    await render("/add?from=2025-01");
    await drop("jan.xls", "card.pdf", "feb.xls");

    expect(title()).toBe(
      "These are from Sample Savings ending 0012 and Sample Card Co Credit Card ending 0505.",
    );
    expect(text()).toContain("Add one account's statements at a time.");
    expect(primary()).toEqual(["Start with Sample Savings"]);
    await click("Start with Sample Savings");
    expect(sent[1].files).toEqual(["jan.xls", "feb.xls"]);
    expect(title()).toBe("Sample Bank · ending 0012");
  });

  it("carries the files of an account in the books to Import", async () => {
    answers["POST /add-account/read"] = () =>
      ok(
        reading([
          candidate({
            status: "in_books",
            account: { id: 4, name: "Sample Joint" },
          }),
        ]),
      );
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");

    expect(title()).toBe("Sample Joint is already in your books");
    await click("Import these");
    expect(where()).toBe("/import files:jan.xls,feb.xls");
  });

  it("starts after a gap by leaving out the files before it", async () => {
    const names = ["jan.xls", "feb.xls", "apr.xls"];
    const periods = [
      { first_date: "2025-01-01", last_date: "2025-01-31" },
      { first_date: "2025-02-01", last_date: "2025-02-28" },
      { first_date: "2025-04-01", last_date: "2025-04-30" },
    ];
    answers["POST /add-account/read"] = (form) => {
      if (form!.getAll("files").length === 1) {
        return ok(
          reading([
            candidate({
              file_names: ["apr.xls"],
              period: periods[2],
              opening: { date: "2025-03-31", amount: 12000 },
            }),
          ]),
        );
      }
      const gapped = reading([
        candidate({
          file_names: names,
          refusal: {
            error: "statement_boundary_mismatch",
            message: "Statements don't meet.",
            reason: "gap",
            earlier_source: "feb.xls",
            later_source: "apr.xls",
            earlier_closing: 10000,
            later_opening: 12000,
            difference: 2000,
          },
        }),
      ]);
      gapped.files = gapped.files.map((file, i) =>
        file.status === "read" ? { ...file, period: periods[i] } : file,
      );
      return ok(gapped);
    };
    await render("/add?from=2025-01");
    await drop(...names);

    expect(title()).toBe("A statement between Feb and Apr 2025 is missing");
    expect(primary()).toEqual(["Add it"]);
    await click("Start from Apr");
    expect(sent[1].files).toEqual(["apr.xls"]);
    // ?from moved with it, so no late-start card follows.
    expect(where()).toBe("/add?from=2025-04 files:");
    expect(title()).toBe("Sample Bank · ending 0012");
  });

  it("goes back to Drop for the missing months of a late start", async () => {
    answers["POST /add-account/read"] = () =>
      ok(
        reading([
          candidate({
            period: { first_date: "2025-03-01", last_date: "2025-04-30" },
          }),
        ]),
      );
    await render("/add?from=2025-01");
    await drop("mar.xls");

    expect(title()).toBe("These start in Mar 2025, not Jan");
    await click("Add Jan–Feb");
    expect(title()).toBe("Drop the rest of its statements");
    expect(text()).toContain("Dropped so far: mar.xls");

    await drop("jan.xls");
    expect(sent[1].files).toEqual(["mar.xls", "jan.xls"]);
  });

  it("hands a file no parser reads to the coding agent and checks again", async () => {
    let checks = 0;
    answers["POST /add-account/read"] = () =>
      ++checks === 1
        ? ok(
            reading(
              [],
              [
                {
                  status: "unrecognized",
                  file_name: "sample.pdf",
                  saved_path: "tmp/statement-uploads/050505/sample.pdf",
                  candidate_parser_paths: [],
                },
              ],
            ),
          )
        : ok(reading([candidate({ file_names: ["sample.pdf"] })]));
    await render("/add?from=2025-01");
    await drop("sample.pdf");

    expect(title()).toBe("dbu6 can't read this statement yet");
    expect(text()).toContain("Copy prompt");
    expect(primary()).toEqual(["Check again"]);
    await click("Check again");
    expect(sent[1].files).toEqual(["sample.pdf"]);
    expect(title()).toBe("Sample Bank · ending 0012");
  });

  it("sends a file several parsers read to the coding agent too", async () => {
    answers["POST /add-account/read"] = () =>
      ok(
        reading(
          [],
          [
            {
              status: "ambiguous",
              file_name: "sample.csv",
              saved_path: "tmp/statement-uploads/050505/sample.csv",
              matching_parser_paths: ["sample-bank-csv", "other-bank-csv"],
            },
          ],
        ),
      );
    await render("/add?from=2025-01");
    await drop("sample.csv");

    expect(title()).toBe("dbu6 can't read this statement yet");
    expect(text()).toContain("More than one format claims it.");
    // The prompt, under Show the prompt, points at the staged copy.
    expect(text()).toContain("tmp/statement-uploads/050505/sample.csv");
  });

  it("shows another refusal as /import does, its fix the one primary", async () => {
    answers["POST /add-account/read"] = (form) =>
      form!.getAll("files").length === 2
        ? ok(
            reading([
              candidate({
                refusal: {
                  error: "statement_part_unjoinable",
                  message: "Sample part has no balances.",
                  part: "feb.xls",
                },
              }),
            ]),
          )
        : ok(reading([candidate({ file_names: ["feb.xls"] })]));
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");

    expect(title()).toBe("feb.xls has no balances");
    expect(primary()).toEqual(["Keep only feb.xls"]);
    await click("Keep only feb.xls");
    expect(sent[1].files).toEqual(["feb.xls"]);
  });

  it("makes Check again the primary when the refusal has an agent prompt", async () => {
    answers["POST /add-account/read"] = () =>
      ok(
        reading([
          candidate({
            refusal: {
              error: "balance_mismatch",
              message: "Computed closing differs.",
              computed_final: 12000,
              statement_closing: 13000,
              difference: -1000,
              tolerance: 0.01,
              suspected_gap: false,
            },
          }),
        ]),
      );
    await render("/add?from=2025-01");
    await drop("jan.xls", "feb.xls");

    expect(title()).toBe("Transactions don't add up to the closing balance");
    expect(primary()).toEqual(["Check again"]);
  });
});
