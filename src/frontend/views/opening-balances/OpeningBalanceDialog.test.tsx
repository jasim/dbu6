// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OpeningBalanceDialog } from "./OpeningBalanceDialog";
import type { OpeningRow } from "./opening-rows";

/*
 * The form that adds one account's opening balance: it opens on the account's
 * own date and suggestion, takes a debit or a credit and a description, and
 * stays open with what the server said when it refuses.
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
  row: OpeningRow | null,
  add: (row: OpeningRow, entry: unknown) => Promise<unknown>,
  onClose = vi.fn(),
) {
  act(() => {
    root.render(
      createElement(OpeningBalanceDialog, {
        row,
        add,
        onClose,
      }) as ReactNode,
    );
  });
  return onClose;
}

/** The dialog renders in a portal, so its fields are looked up on the page. */
function field(label: string): HTMLInputElement {
  const labels = [...document.querySelectorAll("label")];
  const found = labels.find((one) => one.textContent?.startsWith(label));
  const input = found?.querySelector("input");
  if (!input)
    throw new Error(`No ${label} field in:\n${document.body.textContent}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (one) => one.textContent?.trim() === label,
  );
  if (!found) throw new Error(`No ${label} button`);
  return found;
}

function problem(): string {
  return document.querySelector('[role="alert"]')?.textContent ?? "";
}

describe("OpeningBalanceDialog", () => {
  it("opens on the account's date and its suggested side", () => {
    render(SAVINGS, vi.fn());

    expect(field("Opening date").value).toBe("2026-02-02");
    expect(field("Debit").value).toBe("1000.00");
    expect(field("Credit").value).toBe("");
    expect(document.body.textContent).toContain("Assets:Bank:Sample Savings");
    expect(document.body.textContent).toContain("First transaction");
  });

  it("adds the entry with its description, then closes", async () => {
    const add = vi.fn(async () => ({ journal_id: 44 }));
    const onClose = render(SAVINGS, add);

    act(() => type(field("Description"), "From the NOPII March statement"));
    await act(async () => button("Add opening balance").click());

    expect(add).toHaveBeenCalledWith(SAVINGS, {
      date: "2026-02-02",
      amount: 1000,
      description: "From the NOPII March statement",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("puts a credit on the other side of the books", async () => {
    const add = vi.fn(async () => ({ journal_id: 44 }));
    render({ ...SAVINGS, debit: null, credit: null, suggested: null }, add);

    act(() => type(field("Credit"), "2500"));
    await act(async () => button("Add opening balance").click());

    expect(add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: -2500 }),
    );
  });

  it("says what is missing and posts nothing", async () => {
    const add = vi.fn(async () => ({ journal_id: 44 }));
    const onClose = render(
      { ...SAVINGS, debit: null, credit: null, suggested: null },
      add,
    );

    await act(async () => button("Add opening balance").click());
    expect(problem()).toContain("Enter a debit or a credit");

    act(() => {
      type(field("Debit"), "1000");
      type(field("Opening date"), "2026-02-03");
    });
    await act(async () => button("Add opening balance").click());
    expect(problem()).toContain("before the account's first transaction");

    expect(add).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open with what the server said when it refuses", async () => {
    const add = vi.fn(async () => {
      throw { body: { error: "Sample Savings already has an opening entry" } };
    });
    const onClose = render(SAVINGS, add);

    await act(async () => button("Add opening balance").click());

    expect(problem()).toContain("already has an opening entry");
    expect(onClose).not.toHaveBeenCalled();
  });
});
