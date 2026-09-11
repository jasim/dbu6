import type { Abacus } from "../abacus/index.js";
import type { Account } from "./Account.js";

export interface CategorizedTransaction {
  transaction: Abacus;
  account: Account;
}
