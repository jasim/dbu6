// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ReportPeriodField, useReportPeriod } from "./ReportPeriodField";

/*
 * The period field on a date-range report: what it shows for each kind of
 * period, and picking a custom range on the calendar into the URL.
 */

vi.mock("@sapporta/frontend", () => ({ appTimeZone: () => "Asia/Kolkata" }));

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 16 September 2026 in Kolkata.
  vi.setSystemTime(new Date("2026-09-16T06:00:00Z"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Report() {
  const { period, dates, setPeriod } = useReportPeriod();
  const { search } = useLocation();
  return createElement(
    "div",
    null,
    createElement("code", null, search),
    createElement("output", null, JSON.stringify(dates)),
    createElement(ReportPeriodField, { period, onChange: setPeriod }),
  );
}

async function renderAt(search: string) {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/reports/income-statement${search}`] },
        createElement(Report),
      ),
    );
  });
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const location = () => host.querySelector("code")?.textContent;
const asked = () => host.querySelector("output")?.textContent;
const rangeField = () =>
  host.querySelector<HTMLButtonElement>('[aria-label^="Custom range:"]');
// The calendar opens in a portal.
const calendarDay = (date: string) =>
  document.querySelector<HTMLButtonElement>(`td[data-day="${date}"] button`);

async function click(element: HTMLElement | null) {
  if (!element)
    throw new Error(`Nothing to click in: ${document.body.textContent}`);
  await act(async () => element.click());
  await settle();
}

describe("the report period field", () => {
  it("shows the dates a preset covers, with no calendar", async () => {
    await renderAt("?account_id=7&period=this-financial-year");

    expect(host.textContent).toContain("This financial year");
    expect(host.textContent).toContain("1 Apr – 16 Sep 2026");
    expect(asked()).toBe('{"from_date":"2026-04-01","to_date":"2026-09-16"}');
    expect(rangeField()).toBeNull();
  });

  it("shows all time without dates", async () => {
    await renderAt("");

    expect(host.textContent).toContain("All time");
    expect(asked()).toBe("{}");
    expect(rangeField()).toBeNull();
  });

  it("asks for dates on a custom range with none picked", async () => {
    await renderAt("?period=custom");

    expect(host.textContent).toContain("Custom range…");
    expect(rangeField()?.textContent).toBe("Pick dates");
    expect(rangeField()?.getAttribute("aria-label")).toBe(
      "Custom range: none picked",
    );
    expect(asked()).toBe("{}");
  });

  it("turns a preset into a custom range of the same dates", async () => {
    await renderAt("?account_id=7&period=this-month");

    await click(host.querySelector<HTMLElement>('[role="combobox"]'));
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((candidate) => candidate.textContent?.includes("Custom range…"));
    await click(option ?? null);

    expect(location()).toBe(
      "?account_id=7&from_date=2026-09-01&to_date=2026-09-16",
    );
    expect(rangeField()?.textContent).toBe("1–16 Sep 2026");
  });

  it("picks a range with two clicks, in either order, and keeps other parameters", async () => {
    await renderAt("?account_id=7&from_date=2026-04-01&to_date=2026-05-03");
    expect(rangeField()?.textContent).toBe("1 Apr – 3 May 2026");

    await click(rangeField());
    expect(document.body.textContent).toContain("April 2026");

    await click(calendarDay("2026-04-10"));
    expect(location()).toBe(
      "?account_id=7&from_date=2026-04-01&to_date=2026-05-03",
    );

    await click(calendarDay("2026-04-03"));
    expect(location()).toBe(
      "?account_id=7&from_date=2026-04-03&to_date=2026-04-10",
    );
    expect(rangeField()?.textContent).toBe("3–10 Apr 2026");
    expect(rangeField()?.getAttribute("aria-label")).toBe(
      "Custom range: 3–10 Apr 2026",
    );
    expect(calendarDay("2026-04-10")).toBeNull();
  });

  it("keeps the dates it opened with when closed after one click", async () => {
    await renderAt("?from_date=2026-04-01&to_date=2026-05-03");

    await click(rangeField());
    await click(calendarDay("2026-04-10"));
    await click(rangeField());

    expect(calendarDay("2026-04-10")).toBeNull();
    expect(location()).toBe("?from_date=2026-04-01&to_date=2026-05-03");

    // Reopened, it shows the kept range again.
    await click(rangeField());
    expect(
      calendarDay("2026-04-01")?.parentElement?.hasAttribute("data-selected"),
    ).toBe(true);
    expect(
      calendarDay("2026-04-10")?.parentElement?.hasAttribute("data-selected"),
    ).toBe(true);
  });

  it("picks a single day with two clicks on it", async () => {
    await renderAt("?period=custom");

    await click(rangeField());
    // With nothing picked, the calendar opens on this month.
    expect(document.body.textContent).toContain("September 2026");
    await click(calendarDay("2026-09-08"));
    await click(calendarDay("2026-09-08"));

    expect(location()).toBe("?from_date=2026-09-08&to_date=2026-09-08");
    expect(rangeField()?.textContent).toBe("8 Sep 2026");
  });
});
