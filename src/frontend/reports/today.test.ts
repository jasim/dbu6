import { afterEach, describe, expect, it, vi } from "vitest";
import { today } from "./shared";

vi.mock("@sapporta/frontend", () => ({ appTimeZone: () => "Asia/Kolkata" }));

describe("today", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the date in the workspace's time zone, not UTC", () => {
    vi.useFakeTimers();
    // 20:00 in UTC on 10 March is 01:30 on 11 March in Kolkata.
    vi.setSystemTime(new Date("2026-03-10T20:00:00Z"));

    expect(today()).toBe("2026-03-11");
  });
});
