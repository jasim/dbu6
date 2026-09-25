import type { LedgerAccountType } from "../shared/index";

/** Each account type's accounting term, and what it holds in plain words. */
export const ACCOUNT_TYPE_TERMS: Record<
  LedgerAccountType,
  { term: string; caption: string }
> = {
  Asset: { term: "Assets", caption: "what you own" },
  Liability: { term: "Liabilities", caption: "what you owe" },
  Equity: { term: "Equity", caption: "where your books start" },
  Revenue: { term: "Income", caption: "money coming in" },
  Expense: { term: "Expenses", caption: "money going out" },
};
