import { describe, expect, it } from "vitest";
import {
  importedHref,
  readReviewRun,
  SETUP_HAND_OFF_HREF,
  withReviewRun,
} from "./routes";

describe("what /add hands Review", () => {
  it("reads the note and the first run from the query", () => {
    expect(readReviewRun(new URLSearchParams("imported=1&run=setup"))).toEqual({
      imported: true,
      setup: true,
      counts: null,
    });
    expect(
      readReviewRun(new URLSearchParams("run=later&imported=yes")),
    ).toEqual({ imported: false, setup: false, counts: null });
  });

  it("reads what a later add imported, only with the note", () => {
    expect(
      readReviewRun(new URLSearchParams("imported=1&drafts=40&categorized=12"))
        .counts,
    ).toEqual({ drafts: 40, categorized: 12 });
    expect(
      readReviewRun(new URLSearchParams("drafts=40&categorized=12")).counts,
    ).toBeNull();
    expect(
      readReviewRun(new URLSearchParams("imported=1&drafts=40&categorized=x"))
        .counts,
    ).toBeNull();
  });

  it("appends only what is set", () => {
    expect(withReviewRun("/review/5", {})).toBe("/review/5");
    expect(withReviewRun("/review/5", { setup: false })).toBe("/review/5");
    expect(withReviewRun("/review/5", { setup: true })).toBe(
      "/review/5?run=setup",
    );
  });

  it("hands a later add to the account's Overview, the first run to the picker", () => {
    expect(importedHref(12, { drafts: 40, categorized: 12 })).toBe(
      "/review/12?imported=1&drafts=40&categorized=12",
    );
    expect(SETUP_HAND_OFF_HREF).toBe("/review?imported=1&run=setup");
  });
});
