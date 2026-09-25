import { describe, expect, it } from "vitest";
import { knownInstitution, tidyBankName } from "./bank-names.js";

describe("the bank typed", () => {
  it("is the known one when only case or spaces differ", () => {
    const banks = ["Sample Bank", "Other Bank"];
    expect(knownInstitution(banks, "  sample   BANK ")).toBe("Sample Bank");
    expect(knownInstitution(banks, " New  Bank ")).toBe("New Bank");
    expect(knownInstitution(banks, "Sample Banking")).toBe("Sample Banking");
    expect(knownInstitution(banks, " ")).toBe("");
  });
});
describe("tidyBankName", () => {
  it("drops the company suffix and title-cases long all-caps words", () => {
    expect(tidyBankName("HDFC BANK Ltd.")).toBe("HDFC Bank");
    expect(tidyBankName("STANDARD CHARTERED BANK")).toBe(
      "Standard Chartered Bank",
    );
    expect(tidyBankName("SAMPLE BANK LIMITED")).toBe("Sample Bank");
    expect(tidyBankName("  ABC SAMPLE CARDS LTD, ")).toBe("ABC Sample Cards");
  });

  it("keeps short acronyms and mixed case, and lowers joining words", () => {
    expect(tidyBankName("THE SAMPLE BANK LTD")).toBe("The Sample Bank");
    expect(tidyBankName("STATE BANK OF SAMPLE")).toBe("State Bank of Sample");
    expect(tidyBankName("Sample Bank (NOPII) Ltd")).toBe("Sample Bank (Nopii)");
    expect(tidyBankName("ABC Sample Bank.")).toBe("ABC Sample Bank");
    expect(tidyBankName("")).toBe("");
  });
});
