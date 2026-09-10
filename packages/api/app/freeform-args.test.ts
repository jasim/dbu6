import { describe, expect, it } from "vitest";
import {
  jsonOptionsFromMultipartBody,
  optionsFromMultipartBody,
  respondWithImportErrors,
} from "./freeform-args.js";

describe("freeform multipart argument errors", () => {
  it("returns a declared import error payload when base_account is missing", async () => {
    const response = await respondWithImportErrors(async () =>
      jsonOptionsFromMultipartBody({}),
    );

    expect(response).toEqual({
      status: 400,
      body: {
        error: "missing_multipart_field",
        message: "Missing 'base_account' field",
        field: "base_account",
      },
    });
  });

  it("normalizes credit-card manual balances once while leaving JSON rows in ledger semantics", () => {
    expect(
      jsonOptionsFromMultipartBody({
        base_account: "cc:stanc",
        is_credit_card: "true",
        manual_opening_balance: "1000.5",
        manual_closing_balance: "-2000.75",
      }),
    ).toMatchObject({
      accountKind: "credit-card",
      balanceOverrides: { opening: -1000.5, closing: -2000.75 },
    });
  });

  it("threads the staged Google Pay takeout path into the import options", () => {
    expect(
      optionsFromMultipartBody({ base_account: "assets:bank" }).gpayHtmlPath,
    ).toBeNull();
    expect(
      optionsFromMultipartBody(
        { base_account: "assets:bank" },
        "/tmp/gpay-statement-upload-1.html",
      ).gpayHtmlPath,
    ).toBe("/tmp/gpay-statement-upload-1.html");
    expect(
      jsonOptionsFromMultipartBody(
        { base_account: "assets:bank" },
        "/tmp/gpay-statement-upload-2.html",
      ).gpayHtmlPath,
    ).toBe("/tmp/gpay-statement-upload-2.html");
  });

  it("keeps blank distinct from a zero balance", () => {
    expect(
      optionsFromMultipartBody({
        base_account: "assets:bank",
        manual_opening_balance: " ",
        manual_closing_balance: "0",
      }).balanceOverrides,
    ).toEqual({ opening: null, closing: 0 });
  });

  it("rounds signed inputs symmetrically to minor units", () => {
    expect(
      optionsFromMultipartBody({
        base_account: "assets:bank",
        manual_opening_balance: "-1.005",
        manual_closing_balance: "1.005",
      }).balanceOverrides,
    ).toEqual({ opening: -1.01, closing: 1.01 });
  });

  it.each(["NaN", "Infinity", "1,234.00", "12x", "--1"])(
    "returns typed 400 for malformed manual balance %s",
    async (manual_closing_balance) => {
      const response = await respondWithImportErrors(async () =>
        optionsFromMultipartBody({
          base_account: "assets:bank",
          manual_closing_balance,
        }),
      );
      expect(response).toMatchObject({
        status: 400,
        body: {
          error: "invalid_multipart_number",
          field: "manual_closing_balance",
        },
      });
    },
  );
});
