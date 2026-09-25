import { describe, expect, it } from "vitest";
import {
  draftsHandOffHref,
  readReviewRun,
  SETUP_HAND_OFF_HREF,
  withReviewRun,
} from "./routes";

describe("what /add hands Review", () => {
  it("reads the note and the first run from the query", () => {
    expect(readReviewRun(new URLSearchParams("imported=1&run=setup"))).toEqual({
      imported: true,
      setup: true,
    });
    expect(
      readReviewRun(new URLSearchParams("run=later&imported=yes")),
    ).toEqual({ imported: false, setup: false });
  });

  it("appends only what is set", () => {
    expect(withReviewRun("/review/5", {})).toBe("/review/5");
    expect(withReviewRun("/review/5", { setup: false })).toBe("/review/5");
    expect(withReviewRun("/review/5", { setup: true })).toBe(
      "/review/5?run=setup",
    );
  });

  it("hands a later add to the account's drafts, the first run to the picker", () => {
    expect(draftsHandOffHref(12)).toBe("/review/12/drafts?imported=1");
    expect(SETUP_HAND_OFF_HREF).toBe("/review?imported=1&run=setup");
  });
});
