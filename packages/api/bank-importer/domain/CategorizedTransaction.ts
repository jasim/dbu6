import type { Abacus } from "../../modules/statement/index.js";
import type { Account } from "../../modules/values/index.js";

export interface CategorizedTransaction {
  transaction: Abacus;
  account: Account;
}
