import type { ChartAccount, LedgerAccountType } from "../../../shared/index.js";

/*
 * The chart of accounts a new user starts from: a salaried household in
 * India, with no bank, card, fund or person named. The group accounts that
 * the banks and cards step files accounts under (Bank Accounts, Credit
 * Cards, Loans) are here so that it has parents. The seed's demo books are
 * this chart with its demo accounts added (`chartWithAccounts`).
 *
 * Each type has one top account. Where an account sits comes from where it
 * is written here, never from its name.
 */

type Tree = { [name: string]: Tree };

const TREE: Record<LedgerAccountType, Tree> = {
  Asset: {
    Assets: {
      "Bank Accounts": {},
      Cash: {},
      Receivables: {},
      Investments: {
        EPF: {},
        PPF: {},
        NPS: {},
        "Mutual Funds": {},
        Stocks: {},
        Gold: {},
      },
      Deposits: {},
    },
  },
  Liability: {
    Liabilities: { "Credit Cards": {}, Loans: {} },
  },
  Equity: {
    Equity: { "Opening Balances": {} },
  },
  Revenue: {
    Income: {
      Salary: { "Gross Pay": {}, "Employer PF": {}, "Performance Bonus": {} },
      Interest: {
        "Savings Interest": {},
        "Fixed Deposit Interest": {},
        "EPF Interest": {},
        "PPF Interest": {},
      },
      Dividends: { "Stock Dividends": {} },
      Rewards: { "Card Cashback": {} },
    },
  },
  Expense: {
    Expenses: {
      Housing: { Rent: {}, "House Help": {}, "Repairs & Maintenance": {} },
      Utilities: {
        Electricity: {},
        Water: {},
        "Cooking Gas": {},
        Internet: {},
        Mobile: {},
      },
      Food: {
        Groceries: {},
        "Milk & Dairy": {},
        "Dining Out": {},
        "Food Delivery": {},
      },
      Transport: {
        Fuel: {},
        "Cabs & Autos": {},
        Metro: {},
        "Car Maintenance": {},
        "Tolls & Parking": {},
      },
      Insurance: {
        "Term Life Insurance": {},
        "Health Insurance": {},
        "Parents' Health Insurance": {},
        "Car Insurance": {},
      },
      Health: { Medicines: {}, "Doctor & Lab": {}, Fitness: {} },
      Personal: { Grooming: {}, Clothing: {} },
      Shopping: { Household: {}, Electronics: {}, Furniture: {} },
      Subscriptions: { Streaming: {}, Software: {} },
      Entertainment: { Movies: {}, Outings: {} },
      Travel: {
        "Travel Tickets": {},
        "Hotels & Stays": {},
        "Local Travel": {},
      },
      Children: {
        "School Fees": {},
        "Kids' Activities": {},
        "Books & Toys": {},
      },
      Family: { "Parents' Support": {}, Gifts: {}, Festivals: {} },
      Giving: { Donations: {} },
      Education: { "Courses & Books": {} },
      Taxes: { "Income Tax": {}, "Professional Tax": {} },
      Finance: { "Loan Interest": {}, "Bank Charges": {} },
    },
  },
};

// A line under the accounts whose purpose isn't plain from the name.
const NOTES: Record<string, string> = {
  "Bank Accounts":
    "Your savings and current accounts; the next step adds each one here.",
  "Credit Cards": "Each card you get statements for goes here.",
  Loans: "Car, home or personal loans you repay.",
  Receivables: "Money others owe you.",
  "Opening Balances":
    "What each account held when you started; needed for balance checks.",
  "Employer PF": "Your employer's share of EPF, from the payslip.",
};

/** The starter chart, each parent ahead of its children. */
export const STARTER_CHART: readonly ChartAccount[] = Object.entries(
  TREE,
).flatMap(([type, tops]) => {
  const walk = (children: Tree, parent: string | null): ChartAccount[] =>
    Object.entries(children).flatMap(([name, below]) => [
      {
        name,
        account_type: type as LedgerAccountType,
        parent,
        note: NOTES[name] ?? null,
      },
      ...walk(below, name),
    ]);
  return walk(tops, null);
});

/**
 * Starter accounts the checklist opens unticked, with everything under them:
 * ones many households have no use for. The user ticks what they need.
 */
export const STARTER_UNTICKED: readonly string[] = [
  "Receivables",
  "NPS",
  "Stocks",
  "Gold",
  "Dividends",
  "Children",
  "Education",
];

/**
 * `chart` with `added` accounts, each under the parent it names and of that
 * parent's type, after the chart's own accounts. Throws when a parent is not
 * in the chart, or a name is taken.
 */
export function chartWithAccounts(
  chart: readonly ChartAccount[],
  added: readonly { name: string; parent: string }[],
): ChartAccount[] {
  const all = [...chart];
  for (const { name, parent } of added) {
    const under = all.find((account) => account.name === parent);
    if (under === undefined)
      throw new Error(`No account ${parent} for ${name}.`);
    if (all.some((account) => account.name === name)) {
      throw new Error(`The chart already has an account ${name}.`);
    }
    all.push({ name, account_type: under.account_type, parent, note: null });
  }
  return all;
}
