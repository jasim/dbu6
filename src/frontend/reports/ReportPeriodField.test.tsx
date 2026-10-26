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
import { ReportPeriodField, useReportPeriod } from "./ReportPeriodField";

/*
 * The period field on a date-range report: what it shows for each kind of
 * period, choosing from its popup, picking exact dates on the calendar, and
 * stepping with [ and ], all into the URL.
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        span: { first_date: "2024-06-12", last_date: "2026-09-10" },
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
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
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: [`/reports/income-statement${search}`] },
          createElement(Report),
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

const location = () => host.querySelector("code")?.textContent;
const asked = () => host.querySelector("output")?.textContent;
const trigger = () =>
  host.querySelector<HTMLButtonElement>('[aria-label^="Period:"]');
// The popup opens in a portal.
const menuButton = (name: string) =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>("[role=dialog] button"),
  ).find((candidate) => candidate.textContent?.trim() === name) ?? null;
// The calendar opens in a portal.
const calendarDay = (date: string) =>
  document.querySelector<HTMLButtonElement>(`td[data-day="${date}"] button`);

async function click(element: HTMLElement | null) {
  if (!element)
    throw new Error(`Nothing to click in: ${document.body.textContent}`);
  await act(async () => element.click());
  await settle();
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

describe("the report period field", () => {
  it("names a preset and shows the dates it covers", async () => {
    await renderAt("?account_id=7&period=this-financial-year");

    expect(trigger()?.textContent).toBe("This financial year");
    expect(host.textContent).toContain("1 Apr – 16 Sep 2026");
    expect(asked()).toBe('{"from_date":"2026-04-01","to_date":"2026-09-16"}');
  });

  it("shows all time over the days the books cover, asking for no dates", async () => {
    await renderAt("");

    expect(trigger()?.textContent).toBe("All time");
    expect(host.textContent).toContain("12 Jun 2024 – 16 Sep 2026");
    expect(asked()).toBe("{}");
  });

  it("asks for dates on a custom range with none picked", async () => {
    await renderAt("?period=custom");

    expect(trigger()?.textContent).toBe("Pick dates");
    expect(asked()).toBe("{}");
  });

  it("chooses all time or a preset from the popup, keeping other parameters", async () => {
    await renderAt("?account_id=7&period=this-month");

    await click(trigger());
    expect(menuButton("This month")?.getAttribute("aria-pressed")).toBe("true");
    await click(menuButton("All time"));
    expect(location()).toBe("?account_id=7");

    await click(trigger());
    await click(menuButton("Last financial year"));
    expect(location()).toBe("?account_id=7&period=last-financial-year");
    expect(trigger()?.textContent).toBe("Last financial year");
  });

  it("picks exact dates with two clicks, in either order", async () => {
    await renderAt("?account_id=7&from_date=2026-04-01&to_date=2026-05-03");
    expect(trigger()?.textContent).toBe("1 Apr – 3 May 2026");

    await click(trigger());
    await click(menuButton("Exact dates…"));
    expect(document.body.textContent).toContain("April 2026");

    await click(calendarDay("2026-04-10"));
    expect(location()).toBe(
      "?account_id=7&from_date=2026-04-01&to_date=2026-05-03",
    );

    await click(calendarDay("2026-04-03"));
    expect(location()).toBe(
      "?account_id=7&from_date=2026-04-03&to_date=2026-04-10",
    );
    expect(trigger()?.textContent).toBe("3–10 Apr 2026");
    // Named once, on the button.
    expect(host.textContent?.split("3–10 Apr 2026")).toHaveLength(2);
    expect(calendarDay("2026-04-10")).toBeNull();
  });

  it("keeps the dates it opened with when closed after one click", async () => {
    await renderAt("?from_date=2026-04-01&to_date=2026-05-03");

    await click(trigger());
    await click(menuButton("Exact dates…"));
    await click(calendarDay("2026-04-10"));
    await click(trigger());

    expect(calendarDay("2026-04-10")).toBeNull();
    expect(location()).toBe("?from_date=2026-04-01&to_date=2026-05-03");
  });

  it("steps with [ and ], lighting a preset it lands on", async () => {
    await renderAt("?period=this-month");

    await act(async () => press("["));
    await settle();
    expect(location()).toBe("?from_date=2026-08-01&to_date=2026-08-31");
    expect(trigger()?.textContent).toBe("Last month");

    await act(async () => press("]"));
    await settle();
    expect(location()).toBe("?from_date=2026-09-01&to_date=2026-09-16");
    expect(trigger()?.textContent).toBe("This month");

    // Nothing after today.
    await act(async () => press("]"));
    await settle();
    expect(location()).toBe("?from_date=2026-09-01&to_date=2026-09-16");
  });
});
