import { describe, expect, it } from "vitest";
import type { SampleFinding, StatementFormatRow } from "../../shared/index";
import { findingChecks, rowChecks } from "./format-checks";

const ROW: StatementFormatRow = {
  account_id: 9,
  name: "Sample Current",
  kind: "bank",
  institution: "Sample Bank",
  parsers: [],
  account_identifiers: [],
  status: "needs_sample",
  staged_sample: null,
};

const FINDING: Extract<SampleFinding, { outcome: "recognized" }> = {
  outcome: "recognized",
  parser: "sample-bank-xls",
  printed_identifier: "050505000099",
  printed_institution: null,
  period: null,
  parser_institution: null,
  institution: "Sample Bank",
  moves: false,
  identifier_state: "set",
  changes: [],
  keep_mine: null,
};

const states = (checks: { state: string; note: string | null }[]) =>
  checks.map((check) => [check.state, check.note]);

describe("rowChecks", () => {
  it("marks what the account has and what it lacks", () => {
    expect(rowChecks(ROW)).toEqual([
      { label: "Format", state: "missing", value: null, note: null },
      { label: "Number", state: "missing", value: null, note: null },
    ]);
    expect(
      rowChecks({
        ...ROW,
        parsers: ["sample-bank-xls"],
        account_identifiers: ["050505000012"],
      }).map((check) => [check.state, check.value]),
    ).toEqual([
      ["set", "sample-bank-xls"],
      ["set", "050505000012"],
    ]);
  });

  it("says a parser is being written for a staged sample", () => {
    expect(
      states(rowChecks({ ...ROW, staged_sample: "tmp/NOPII.pdf" })),
    ).toEqual([
      ["waiting", "parser being written"],
      ["missing", null],
    ]);
  });
});

describe("findingChecks", () => {
  it("marks what the sample adds", () => {
    expect(states(findingChecks(ROW, FINDING))).toEqual([
      ["adds", "new"],
      ["adds", "new"],
    ]);
  });

  it("says where the account moves, and a number that differs", () => {
    const checks = findingChecks(
      { ...ROW, account_identifiers: ["050505000012"] },
      {
        ...FINDING,
        moves: true,
        parser_institution: "Other Bank",
        institution: "Other Bank",
        identifier_state: "different",
      },
    );
    expect(states(checks)).toEqual([
      ["adds", "moves to Other Bank"],
      ["conflict", "you gave 050505000012"],
    ]);
  });

  it("keeps the account's number when the statement prints none", () => {
    expect(
      findingChecks(
        { ...ROW, account_identifiers: ["050505000012"] },
        {
          ...FINDING,
          parser_institution: "Sample Bank",
          printed_identifier: null,
          identifier_state: "none_printed",
        },
      ).map((check) => [check.state, check.value]),
    ).toEqual([
      ["set", "sample-bank-xls"],
      ["set", "050505000012"],
    ]);
  });
});
