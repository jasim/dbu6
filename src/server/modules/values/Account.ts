export type Account = string & { readonly __brand: "Account" };

export function parseAccount(name: string): Account {
  if (!name || name.trim().length === 0) {
    throw new Error("Account name cannot be empty");
  }
  return name as Account;
}

export const UNCATEGORIZED = "UNCATEGORIZED" as Account;
