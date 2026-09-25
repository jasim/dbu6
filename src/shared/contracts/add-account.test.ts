import { describe, expect, it } from "vitest";
import {
  promptedFiles,
  type AddAccountCandidate,
  type AddAccountFile,
} from "./add-account.js";
import type { StatementImportError } from "./import-errors.js";

const GAP: StatementImportError = {
  error: "statement_boundary_mismatch",
  message: "Statements don't meet.",
  reason: "gap",
  earlier_source: "NOPII-jan.xls",
  later_source: "NOPII-feb.xls",
  earlier_closing: 10000,
  later_opening: 12000,
  difference: 2000,
};
const TWICE: StatementImportError = { ...GAP, reason: "same-statement-twice" };

function account(more: Partial<AddAccountCandidate> = {}): AddAccountCandidate {
  return {
    key: "new:bank:050505000099",
    status: "new",
    account: null,
    institution: "Sample Bank",
    institution_listed: false,
    kind: "bank",
    identifier: "050505000099",
    parsers: ["sample-bank-xls"],
    file_names: ["NOPII-jan.xls", "NOPII-feb.xls"],
    period: { first_date: "2026-01-03", last_date: "2026-02-10" },
    transactions: 4,
    opening: { date: "2026-01-02", amount: 10000 },
    needs_opening: false,
    opening_refusal: null,
    refusal: TWICE,
    ...more,
  };
}

function read(name: string): AddAccountFile {
  return {
    status: "read",
    file_name: name,
    account_key: "new:bank:050505000099",
    parser: "sample-bank-xls",
    period: null,
    transactions: 2,
    saved_path: null,
  };
}

const unread: AddAccountFile = {
  status: "unrecognized",
  file_name: "NOPII.pdf",
  saved_path: "tmp/statement-uploads/sample/1-NOPII.pdf",
  candidate_parser_paths: [],
};

describe("promptedFiles", () => {
  const files = [read("NOPII-jan.xls"), read("NOPII-feb.xls")];

  it("is the files no parser reads, whatever else the drop holds", () => {
    expect(
      promptedFiles({ files: [files[0], unread], accounts: [account()] }),
    ).toEqual([1]);
  });

  it("is all of one account's files when its refusal gets a prompt", () => {
    expect(promptedFiles({ files, accounts: [account()] })).toEqual([0, 1]);
  });

  it("is none where the card shows no prompt", () => {
    for (const accounts of [
      [account(), account({ key: "account:2" })],
      [account({ status: "in_books" })],
      [account({ transactions: 0 })],
      [account({ opening: null })],
      [account({ refusal: GAP })],
      [account({ refusal: null })],
    ]) {
      expect(promptedFiles({ files, accounts })).toBeNull();
    }
  });
});
