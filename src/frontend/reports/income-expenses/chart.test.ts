import { describe, expect, it } from "vitest";
import { MINUS } from "../../components/amount";
import { barHeight, chartBars, chartScale } from "./chart";

const dates = (first_date: string, last_date: string) => ({
  first_date,
  last_date,
});

/** Every month from `from`, `count` of them, with income and spending of 100 each. */
function months(from: string, count: number) {
  const [year, month] = from.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const total = year * 12 + month - 1 + index;
    const key = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    return { month: key, income: 100, spending: 100 };
  });
}

describe("month bars", () => {
  const today = "2026-09-16";

  it("label the short month, with the year on the first bar and each January", () => {
    const bars = chartBars(
      months("2025-10", 12),
      dates("2025-10-01", today),
      today,
    );

    expect(bars.map((bar) => [bar.label, bar.year])).toEqual([
      ["Oct", "2025"],
      ["Nov", null],
      ["Dec", null],
      ["Jan", "2026"],
      ["Feb", null],
      ["Mar", null],
      ["Apr", null],
      ["May", null],
      ["Jun", null],
      ["Jul", null],
      ["Aug", null],
      ["Sep", null],
    ]);
  });

  it("mark this month so far only while the period ends today", () => {
    const soFar = (last: string) =>
      chartBars(months("2026-08", 2), dates("2026-08-01", last), today)
        .filter((bar) => bar.soFar)
        .map((bar) => bar.key);

    expect(soFar(today)).toEqual(["2026-09"]);
    expect(soFar("2026-09-10")).toEqual([]);
  });

  it("narrow to the month clicked, never past today", () => {
    const bars = chartBars(
      months("2026-07", 3),
      dates("2026-07-05", today),
      today,
    );

    expect(bars.map((bar) => bar.dates)).toEqual([
      dates("2026-07-01", "2026-07-31"),
      dates("2026-08-01", "2026-08-31"),
      dates("2026-09-01", today),
    ]);
  });

  it("describe the month's figures with their signs", () => {
    const [march] = chartBars(
      [{ month: "2026-03", income: 120000, spending: 84500 }],
      dates("2026-03-01", "2026-03-31"),
      today,
    );

    expect(march?.description).toBe(
      `March 2026 · Income +₹1,20,000.00 · Spending ${MINUS}₹84,500.00`,
    );
  });

  it("stay monthly up to 24 months", () => {
    const bars = chartBars(
      months("2024-10", 24),
      dates("2024-10-01", today),
      today,
    );

    expect(bars).toHaveLength(24);
    expect(bars[0]?.key).toBe("2024-10");
  });
});

describe("financial year bars", () => {
  const today = "2026-09-16";

  it("sum the months into financial years past 24 months", () => {
    const bars = chartBars(
      months("2024-09", 25),
      dates("2024-09-01", today),
      today,
    );

    expect(
      bars.map((bar) => [bar.label, bar.income, bar.spending, bar.soFar]),
    ).toEqual([
      ["FY 2024–25", 700, 700, false],
      ["FY 2025–26", 1200, 1200, false],
      ["FY 2026–27", 600, 600, true],
    ]);
  });

  it("narrow to the financial year clicked, never past today", () => {
    const bars = chartBars(
      months("2024-09", 25),
      dates("2024-09-01", today),
      today,
    );

    expect(bars.map((bar) => bar.dates)).toEqual([
      dates("2024-04-01", "2025-03-31"),
      dates("2025-04-01", "2026-03-31"),
      dates("2026-04-01", today),
    ]);
    expect(bars[1]?.description).toBe(
      `FY 2025–26 · Income +₹1,200.00 · Spending ${MINUS}₹1,200.00`,
    );
  });
});

describe("the scale", () => {
  it("is the largest bar, and a negative amount draws nothing", () => {
    const bars = chartBars(
      [
        { month: "2026-01", income: 500, spending: -50 },
        { month: "2026-02", income: 200, spending: 800 },
      ],
      dates("2026-01-01", "2026-02-28"),
      "2026-09-16",
    );

    expect(chartScale(bars)).toBe(800);
    expect(barHeight(400, 800)).toBe(0.5);
    expect(barHeight(-50, 800)).toBe(0);
    expect(barHeight(0, 0)).toBe(0);
  });
});
