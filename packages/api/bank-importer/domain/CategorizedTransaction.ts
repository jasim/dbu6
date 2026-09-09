import type { Abacus } from "./Abacus.js";
import type { Account } from "./Account.js";

export interface CategorizedTransaction {
  transaction: Abacus;
  account: Account;
}
