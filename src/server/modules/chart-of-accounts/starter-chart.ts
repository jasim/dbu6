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

/**
 * The groups the banks and cards step files each bank account, card and
 * loan under. They start with nothing under them, and a statement line
 * never goes to one.
 */
export const BANK_CARD_LOAN_GROUPS: readonly string[] = [
  "Bank Accounts",
  "Credit Cards",
  "Loans",
];

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

// What goes to an account, where its name doesn't say: shown on hover, and
// the categorizer's first instructions. For the categorizer they name the
// kinds of statement line, in general terms and never a merchant, for the
// accounts that gather many kinds or whose lines don't carry their name; the
// user adds their own specifics later. No group with accounts under it has
// one; the notes on BANK_CARD_LOAN_GROUPS are for the hover alone, and the
// instructions leave them out.
const NOTES: Record<string, string> = {
  "Bank Accounts": "Each of your savings and current accounts goes under this.",
  "Credit Cards": "Each card you get statements for goes under this.",
  Loans: "Each car, home or personal loan you repay goes under this.",
  Cash: "ATM and cash withdrawals.",
  Receivables: "Money others owe you.",
  "Mutual Funds": "Mutual fund purchases and regular investment plan debits.",
  "Opening Balances":
    "What each account held when you started; needed for balance checks.",
  "Employer PF": "Your employer's share of EPF, from the payslip.",
  "Savings Interest": "Interest a savings account credits.",
  "Card Cashback": "Cashback and reward credits on a card.",
  Groceries: "Supermarkets, grocery stores and grocery delivery apps.",
  "Dining Out": "Restaurants, cafés, bakeries, bars and food courts.",
  "Food Delivery":
    "Meal orders from food delivery apps; their grocery orders go to Groceries.",
  Fuel: "Fuel stations.",
  "Cabs & Autos": "Taxis and ride-hailing apps.",
  "Tolls & Parking": "Tolls, toll-tag top-ups and parking.",
  Mobile: "Phone recharges and mobile bills.",
  Medicines: "Pharmacies and medicine delivery.",
  "Doctor & Lab": "Hospitals, clinics and diagnostic labs.",
  Streaming: "Video and music streaming subscriptions.",
  "Travel Tickets":
    "Airlines, trains, long-distance buses and travel booking sites.",
  "Income Tax": "Income tax paid to the tax authority.",
  "Bank Charges":
    "Bank and card fees, annual fees, late payment and finance charges, and the tax on them.",
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
