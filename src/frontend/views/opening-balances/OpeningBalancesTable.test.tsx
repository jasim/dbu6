// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OpeningBalancesTable } from "./OpeningBalancesTable";
import type { OpeningRow } from "./opening-rows";

/*
 * The table lists accounts and nothing else: an account waiting for an
 * opening balance offers the button that opens the form, and one the books
 * hold shows what was posted, with its description and a link to the entry.
 */

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const SAVINGS: OpeningRow = {
  accountId: 2,
  name: "Sample Savings",
  path: "Assets:Bank:Sample Savings",
  firstActivityDate: "2026-02-03",
  recorded: null,
  date: "2026-02-02",
  debit: 1000,
  credit: null,
  suggested: "debit",
};

const CARD: OpeningRow = {
  accountId: 4,
  name: "Sample Card",
  path: "Liabilities:Sample Card",
  firstActivityDate: null,
  recorded: { journalId: 31, description: "From the NOPII card statement" },
  date: "2026-01-31",
  debit: null,
  credit: 2500,
  suggested: null,
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(
  rows: OpeningRow[],
  onAdd: (row: OpeningRow) => void,
  focusAccount?: string,
) {
  act(() => {
    root.render(
      createElement(MemoryRouter, null, [
        createElement(OpeningBalancesTable, {
          key: "table",
          rows,
          onAdd,
          focusAccount,
        }),
      ] as ReactNode),
    );
  });
}

/** The figures of the row naming `account`, in column order. */
function cells(account: string): string[] {
  const row = [...host.querySelectorAll("tbody tr")].find((candidate) =>
    candidate.textContent?.includes(account),
  );
  if (!row) throw new Error(`No row for ${account} in:\n${host.textContent}`);
  return [...row.querySelectorAll("td")].map(
    (cell) => cell.textContent?.trim() ?? "",
  );
}

describe("OpeningBalancesTable", () => {
  it("offers the form on an account that has no opening balance yet", () => {
    const onAdd = vi.fn();
    render([SAVINGS], onAdd);

    const button = [...host.querySelectorAll("button")].find(
      (one) => one.textContent === "Add opening balance",
    );
    act(() => button?.click());
    expect(onAdd).toHaveBeenCalledWith(SAVINGS);
  });

  it("shows the date and amount the form would open with", () => {
    render([SAVINGS], vi.fn());

    const [account, first, date, debit, credit, description] =
      cells("Sample Savings");
    // The name leads; where it sits is the quiet line under it.
    expect(account).toBe("Sample SavingsAssets > Bank");
    expect(first).toContain("3 Feb 2026");
    expect(date).toContain("2 Feb 2026");
    expect(debit).toContain("1,000.00");
    expect(credit).toBe("");
    expect(description).toBe("");
  });

  it("leaves a root account without a parent line", () => {
    render([{ ...SAVINGS, path: "Sample Savings" }], vi.fn());

    expect(cells("Sample Savings")[0]).toBe("Sample Savings");
  });

  it("shows what the books hold, with its description and the entry", () => {
    const onAdd = vi.fn();
    render([CARD], onAdd);

    const [, first, , debit, credit, description] = cells("Sample Card");
    expect(first).toBe("None yet");
    expect(debit).toBe("");
    expect(credit).toContain("2,500.00");
    expect(description).toBe("From the NOPII card statement");

    const entry = host.querySelector("a");
    expect(entry?.textContent).toBe("See journal entry");
    expect(entry?.getAttribute("href")).toContain("filter[id][eq]=31");
    expect(host.querySelector("button")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("marks the row a link elsewhere named", () => {
    render([SAVINGS, CARD], vi.fn(), "Sample Savings");

    const marked = host.querySelectorAll('tbody tr[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain("Sample Savings");
  });
});
