import { describe, expect, it } from "vitest";
import { columnName, crc32, xlsxBytes } from "./xlsx";

describe("xlsx", () => {
  it("names columns as Excel does", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "ZZ",
      "AAA",
    ]);
  });

  it("computes the zip's CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a zip with every part and escaped text", () => {
    const bytes = xlsxBytes([
      { name: "Sample", header: ["Account", "Total"], rows: [["A & B", 1000]] },
    ]);
    // A zip starts with a local file header and ends with the end record.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const end = bytes.length - 22;
    expect([...bytes.slice(end, end + 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("A &amp; B");
    expect(text).toContain("<v>1000</v>");
  });
});
