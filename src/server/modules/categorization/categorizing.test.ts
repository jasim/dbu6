import { describe, expect, it } from "vitest";
import { categorizationIdle, whileCategorizing } from "./categorizing.js";

describe("categorizationIdle", () => {
  it("settles at once when nothing categorizes", async () => {
    await expect(categorizationIdle()).resolves.toBeUndefined();
  });

  it("waits for every categorization running, failed ones too", async () => {
    let finishFirst!: () => void;
    let failSecond!: (error: Error) => void;
    const first = whileCategorizing(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    const second = whileCategorizing(
      () => new Promise<void>((_, reject) => (failSecond = reject)),
    ).catch(() => "failed");
    let idle = false;
    const waiting = categorizationIdle().then(() => (idle = true));

    finishFirst();
    await first;
    await Promise.resolve();
    expect(idle).toBe(false);

    failSecond(new Error("sample failure"));
    expect(await second).toBe("failed");
    await waiting;
    expect(idle).toBe(true);
  });
});
