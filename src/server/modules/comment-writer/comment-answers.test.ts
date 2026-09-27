import { describe, expect, it } from "vitest";
import { checkComment, commentVerdicts } from "./comment-answers.js";
import { commentRequestRows } from "./comment-prompt.js";

const UPI =
  "UPI/050505123456/ SAMPLE CAFE/Q0505051@YBL /YESB0YBLUPI/ 050505000025/UPI/ 050505123456/YESBIFC HO/";

describe("checkComment", () => {
  it("keeps a short answer without a reference number", () => {
    expect(checkComment(UPI, "UPI Sample Cafe")).toEqual({
      ok: true,
      comment: "UPI Sample Cafe",
    });
    expect(
      checkComment("IGST-VPS050505123-RATE 18.0 -29", " IGST rate 18.0 "),
    ).toEqual({ ok: true, comment: "IGST rate 18.0" });
  });

  it("passes prose through, however long", () => {
    const prose =
      "sample dinner with the whole family after the NOPII school function";
    expect(prose.length).toBeGreaterThan(60);
    expect(checkComment(prose, prose)).toEqual({ ok: true, comment: prose });
  });

  it("writes the text itself when the answer is empty", () => {
    expect(checkComment("UPI-0505050505@ybl-050505123456", "")).toEqual({
      ok: true,
      comment: "UPI-0505050505@ybl-050505123456",
    });
  });

  it("refuses an answer over 60 characters", () => {
    expect(checkComment(UPI, "UPI Sample Cafe ".repeat(5))).toMatchObject({
      ok: false,
    });
  });

  it("refuses an answer that kept a run of six digits", () => {
    expect(checkComment(UPI, "UPI Sample Cafe 050505123456")).toEqual({
      ok: false,
      reason: "kept a reference number",
    });
    expect(checkComment("NEFT 12345 SAMPLE", "NEFT 12345 Sample")).toEqual({
      ok: true,
      comment: "NEFT 12345 Sample",
    });
  });

  it("refuses an answer that isn't text", () => {
    expect(checkComment(UPI, null)).toMatchObject({ ok: false });
    expect(checkComment(UPI, 42)).toMatchObject({ ok: false });
  });
});

describe("commentVerdicts", () => {
  it("reads each text's answer by the id its row was sent with", () => {
    const texts = [UPI, "CONSOLIDATED FCY MARKU P FEE", "sample0505@okaxis"];
    expect(commentRequestRows(texts).map((row) => row.id)).toEqual([
      "0",
      "1",
      "2",
    ]);

    expect(
      commentVerdicts(texts, [
        { id: "2", comment: "sample0505" },
        { id: "0", comment: "UPI Sample Cafe" },
        { id: "9", comment: "stray" },
        "not a row",
      ]),
    ).toEqual([
      { ok: true, comment: "UPI Sample Cafe" },
      { ok: false, reason: "not answered" },
      { ok: true, comment: "sample0505" },
    ]);
  });
});
