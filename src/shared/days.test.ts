import { parseTimeZone } from "@sapporta/shared/temporal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayLabel, todayIn } from "./days.js";

describe("todayIn", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the date in the workspace's time zone, not the machine's", () => {
    vi.useFakeTimers();
    // 20:00 in UTC on 10 March is 01:30 on 11 March in Kolkata.
    vi.setSystemTime(new Date("2026-03-10T20:00:00Z"));

    expect(todayIn(parseTimeZone("Asia/Kolkata"))).toBe("2026-03-11");
    expect(todayIn(parseTimeZone("UTC"))).toBe("2026-03-10");
  });
});

describe("dayLabel", () => {
  it("names the weekday of a calendar date, whatever the machine's zone", () => {
    expect(dayLabel("2026-03-01")).toBe("Sunday, 1 March 2026");
  });
});
