#!/usr/bin/env node
/**
 * Sample data for development: a demo account holding a year of personal
 * finances for a salaried employee in Bengaluru.
 *
 *   pnpm seed               # the year up to today
 *   pnpm seed 2027-01-15    # the year up to another date
 *
 * The twelve months before the as-of month are posted as journals. The as-of
 * month so far is left as drafts on the HDFC savings account, as if that
 * statement had just been imported. Sign in as demo@example.com with the
 * password demo-password. Re-running replaces that account's accounts,
 * journals, and drafts.
 *
 * The persona is a software engineer, married, with one child in preschool.
 * They rent a flat, repay a car loan, support their parents, and invest through
 * EPF, PPF, NPS, mutual-fund SIPs, stocks, gold, and fixed deposits. Everyday
 * amounts come from a generator seeded the same way on every run. Yearly events
 * (Diwali, insurance renewals, the April appraisal, the June bonus) fall in
 * their calendar month within the seeded year.
 *
 * The API must be running (`pnpm dev`), because the account is created through
 * the app's own sign-up. The ledger rows are then written straight to SQLite.
 * All amounts, payees, and employers here are made up; see AGENTS.md.
 */
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEMO_ACCOUNT = { name: "Demo User", email: "demo@example.com", password: "demo-password" };
const TIME_ZONE = "Asia/Kolkata";

// ── Accounts ──────────────────────────────────────────────────────────────

const HDFC = "assets:bank:hdfc-savings";
const SBI = "assets:bank:sbi-savings";
const CASH = "assets:cash";
const HCC = "liabilities:credit-cards:hdfc-millennia";
const ICC = "liabilities:credit-cards:icici-amazon-pay";
const CAR_LOAN = "liabilities:loans:hdfc-car-loan";
const RECEIVABLES = "assets:receivables:friends";

/** Accounts with a statement: they get balance assertions, as a posted import does. */
const STATEMENT_ACCOUNTS = [HDFC, SBI, HCC, ICC];

/**
 * The account tree: top accounts by account type, each account mapped to the
 * accounts under it. Each account's parent and type come from where it sits
 * here, never from its name. There is no `assets` or `expenses` account at the
 * top, because reports group accounts by the top of their branch (`branchTops`
 * in packages/api/app/account-tree.ts), so these top accounts are the groups
 * they show. Postings may sit on any account, parents included.
 */
const ACCOUNT_TREE = {
  Asset: {
    "assets:bank": { [HDFC]: {}, [SBI]: {} },
    [CASH]: {},
    "assets:receivables": { [RECEIVABLES]: {} },
    "assets:investments": {
      "assets:investments:epf": {},
      "assets:investments:ppf": {},
      "assets:investments:nps": {},
      "assets:investments:mutual-funds": {
        "assets:investments:mutual-funds:parag-parikh-flexi-cap": {},
        "assets:investments:mutual-funds:uti-nifty-50-index": {},
      },
      "assets:investments:stocks": { "assets:investments:stocks:zerodha": {} },
      "assets:investments:gold": {},
    },
    "assets:deposits": { "assets:deposits:hdfc-fixed-deposit": {} },
  },
  Liability: {
    "liabilities:credit-cards": { [HCC]: {}, [ICC]: {} },
    "liabilities:loans": { [CAR_LOAN]: {} },
  },
  Equity: {
    "equity:opening-balances": {},
  },
  Revenue: {
    "income:salary": { "income:salary:gross-pay": {}, "income:salary:employer-pf": {}, "income:salary:performance-bonus": {} },
    "income:interest": { "income:interest:savings": {}, "income:interest:fixed-deposit": {}, "income:interest:epf": {}, "income:interest:ppf": {} },
    "income:dividends": { "income:dividends:stocks": {} },
    "income:rewards": { "income:rewards:card-cashback": {} },
  },
  Expense: {
    "expenses:housing": { "expenses:housing:rent": {}, "expenses:housing:house-help": {}, "expenses:housing:repairs-maintenance": {} },
    "expenses:utilities": {
      "expenses:utilities:electricity": {},
      "expenses:utilities:water": {},
      "expenses:utilities:cooking-gas": {},
      "expenses:utilities:internet": {},
      "expenses:utilities:mobile": {},
    },
    "expenses:food": { "expenses:food:groceries": {}, "expenses:food:milk-dairy": {}, "expenses:food:dining-out": {}, "expenses:food:food-delivery": {} },
    "expenses:transport": {
      "expenses:transport:fuel": {},
      "expenses:transport:cabs-autos": {},
      "expenses:transport:metro": {},
      "expenses:transport:car-maintenance": {},
      "expenses:transport:tolls-parking": {},
    },
    "expenses:insurance": { "expenses:insurance:term-life": {}, "expenses:insurance:health": {}, "expenses:insurance:parents-health": {}, "expenses:insurance:car": {} },
    "expenses:health": { "expenses:health:medicines": {}, "expenses:health:doctor-lab": {}, "expenses:health:fitness": {} },
    "expenses:personal": { "expenses:personal:grooming": {}, "expenses:personal:clothing": {} },
    "expenses:shopping": { "expenses:shopping:household": {}, "expenses:shopping:electronics": {}, "expenses:shopping:furniture": {} },
    "expenses:subscriptions": { "expenses:subscriptions:streaming": {}, "expenses:subscriptions:software": {} },
    "expenses:entertainment": { "expenses:entertainment:movies": {}, "expenses:entertainment:outings": {} },
    "expenses:travel": { "expenses:travel:tickets": {}, "expenses:travel:stays": {}, "expenses:travel:local": {} },
    "expenses:child": { "expenses:child:school-fees": {}, "expenses:child:activities": {}, "expenses:child:books-toys": {} },
    "expenses:family": { "expenses:family:parents-support": {}, "expenses:family:gifts": {}, "expenses:family:festivals": {} },
    "expenses:giving": { "expenses:giving:donations": {} },
    "expenses:education": { "expenses:education:courses-books": {} },
    "expenses:taxes": { "expenses:taxes:income-tax": {}, "expenses:taxes:professional-tax": {} },
    "expenses:finance": { "expenses:finance:loan-interest": {}, "expenses:finance:bank-charges": {} },
  },
};

/** Every account in the tree as { name, parent, type }, each parent ahead of its children. */
export const ACCOUNTS = Object.entries(ACCOUNT_TREE).flatMap(([type, tops]) => {
  const walk = (children, parent) =>
    Object.entries(children).flatMap(([name, below]) => [{ name, parent, type }, ...walk(below, name)]);
  return walk(tops, null);
});
const ACCOUNT_TYPES = new Map(ACCOUNTS.map(({ name, type }) => [name, type]));
if (ACCOUNT_TYPES.size !== ACCOUNTS.length) throw new Error("An account appears twice in ACCOUNT_TREE.");

// ── Dates ─────────────────────────────────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const yearMonth = (date) => date.split("-").slice(0, 2).map(Number);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const endOfMonth = (y, m) => ymd(y, m, daysInMonth(y, m));
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
function addMonths(y, m, months) {
  const total = y * 12 + (m - 1) + months;
  return [Math.floor(total / 12), (total % 12) + 1];
}
function lastWorkingDay(y, m) {
  let d = daysInMonth(y, m);
  while (weekday(y, m, d) === 0 || weekday(y, m, d) === 6) d--;
  return d;
}
function weekendDays(y, m) {
  const days = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) if ([0, 6].includes(weekday(y, m, d))) days.push(d);
  return days;
}
/** Indian financial years run April to March; FY 2025-26 is 2025. */
const financialYear = (y, m) => (m >= 4 ? y : y - 1);
const fyLabel = (fy) => `FY ${fy}-${String(fy + 1).slice(2)}`;

/**
 * The year seeded for an as-of date: opening balances on the day before its
 * first month, twelve posted months, then the as-of month's drafts.
 */
function seededYear(asOf) {
  const [asOfYear, asOfMonth] = yearMonth(asOf);
  const [startYear, startMonth] = addMonths(asOfYear, asOfMonth, -12);
  return {
    asOf,
    asOfYear,
    asOfMonth,
    startYear,
    startMonth,
    openingDate: endOfMonth(...addMonths(startYear, startMonth, -1)),
    lastPostedDate: endOfMonth(...addMonths(asOfYear, asOfMonth, -1)),
  };
}

function randomSource(seed) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    /** A random amount in [min, max], rounded to `step` rupees. */
    amount: (min, max, step = 10) => Math.round(int(min, max) / step) * step,
    /** `count` distinct random days of the month, ascending. */
    randomDays: (y, m, count) => {
      const days = new Set();
      while (days.size < Math.min(count, daysInMonth(y, m))) days.add(int(1, daysInMonth(y, m)));
      return [...days].sort((a, b) => a - b);
    },
  };
}

// ── The ledger ────────────────────────────────────────────────────────────

/**
 * Every transaction of the year seeded for `asOf`: the posted months as
 * journals and the as-of month's HDFC savings rows as drafts, in posting
 * order. Throws if a bank account or the wallet would dip below zero.
 */
export function buildLedger(asOf) {
  const year = seededYear(asOf);
  const latestFinancialYear = financialYear(...yearMonth(year.lastPostedDate));
  const { int, pick, chance, amount, randomDays } = randomSource(20250901);
  const events = [];

  /**
   * One real-world transaction. Postings are [account, rupees, comment?], with
   * debits positive and credits negative, and must sum to zero. `narration` is
   * what a bank statement would show; it defaults to the only comment.
   */
  function txn(date, description, postings, { prio = 5, narration, uncategorized = false } = {}) {
    const rows = postings.map(([account, rupees, comment = null]) => {
      if (!ACCOUNT_TYPES.has(account)) throw new Error(`Unknown account ${account} in "${description}"`);
      return { account, paise: Math.round(rupees * 100), comment };
    });
    const total = rows.reduce((sum, row) => sum + row.paise, 0);
    if (total !== 0) throw new Error(`Unbalanced "${description}" on ${date}: off by ${total / 100}`);
    narration ??= rows.find((row) => row.comment)?.comment ?? description.toUpperCase();
    events.push({ date, description, postings: rows, prio, seq: events.length, narration, uncategorized });
  }
  /** Money leaves `from` (a bank, card, or wallet) for `to`. */
  const pay = (date, from, to, rupees, description, narration, options) =>
    txn(date, description, [[to, rupees, narration], [from, -rupees]], options);
  /** Money arrives in `into` from `from`. */
  const receive = (date, into, from, rupees, description, narration, options) =>
    txn(date, description, [[into, rupees], [from, -rupees, narration]], options);
  const balanceOf = (account, through) =>
    events.reduce((sum, e) => (e.date > through ? sum : sum + e.postings.filter((p) => p.account === account).reduce((s, p) => s + p.paise, 0)), 0);

  /** The date of `month`/`day` within the twelve posted months. */
  function on(month, day) {
    const y = month >= year.startMonth ? year.startYear : year.startYear + 1;
    return ymd(y, month, Math.min(day, daysInMonth(y, month)));
  }

  function openingBalances() {
    const balances = [
      [HDFC, 350000], [SBI, 65000], [CASH, 3500],
      ["assets:investments:epf", 640000],
      ["assets:investments:ppf", 210000],
      ["assets:investments:nps", 125000],
      ["assets:investments:mutual-funds:parag-parikh-flexi-cap", 340000],
      ["assets:investments:mutual-funds:uti-nifty-50-index", 220000],
      ["assets:investments:stocks:zerodha", 160000],
      ["assets:investments:gold", 45000],
      ["assets:deposits:hdfc-fixed-deposit", 150000],
      [HCC, -21400], [ICC, -7850], [CAR_LOAN, -420000],
    ];
    const equity = balances.reduce((sum, [, rupees]) => sum + rupees, 0);
    txn(year.openingDate, "Opening balances", [
      ...balances.map(([account, rupees]) => [account, rupees, "Opening balance"]),
      ["equity:opening-balances", -equity],
    ], { prio: 0 });
  }

  let carLoanOutstanding = 420000;

  function month(y, m) {
    const D = (d) => ymd(y, m, Math.min(d, daysInMonth(y, m)));
    const label = `${MONTHS[m - 1]} ${y}`;
    const mon = `${MONTHS[m - 1].slice(0, 3).toUpperCase()}${String(y).slice(2)}`;
    // The appraisal and the lease renewal both take effect in April.
    const appraised = financialYear(y, m) >= latestFinancialYear;
    const quarterEnd = [3, 6, 9, 12].includes(m);

    // Salary: credited on the last working day, with the payslip's deductions.
    const gross = appraised ? 283400 : 260000;
    const pf = Math.round(gross * 0.4 * 0.12); // 12% of basic, which is 40% of gross
    const tds = appraised ? 50100 : 42800; // new regime, spread over the year
    const professionalTax = m === 2 ? 300 : 200;
    txn(D(lastWorkingDay(y, m)), `Salary — ${label}`, [
      [HDFC, gross - pf - tds - professionalTax],
      ["assets:investments:epf", pf * 2, "Employee and employer PF contribution"],
      ["expenses:taxes:income-tax", tds, "TDS on salary"],
      ["expenses:taxes:professional-tax", professionalTax, "Professional tax"],
      ["income:salary:gross-pay", -gross, "Gross pay"],
      ["income:salary:employer-pf", -pf, "Employer PF contribution"],
    ], { prio: 1, narration: `NEFT CR-SAMPLE TECHNOLOGIES PVT LTD-SALARY ${mon}` });

    // Housing, run from the SBI household account
    pay(D(2), HDFC, "expenses:housing:rent", appraised ? 33600 : 32000, `Rent — ${label}`, `UPI/RENT ${mon}/landlord.sample@okhdfcbank`);
    txn(D(3), "Transfer to SBI household account", [[SBI, 27500, "IMPS/SELF TRANSFER/HDFC SAVINGS"], [HDFC, -27500]]);
    pay(D(5), SBI, "expenses:housing:house-help", 3500, "Maid salary", "UPI/HOUSE HELP/maid.sample@oksbi");
    pay(D(5), SBI, "expenses:housing:house-help", 5500, "Cook salary", "UPI/COOK/cook.sample@oksbi");
    pay(D(1), SBI, "expenses:food:milk-dairy", amount(2200, 2700), "Milk subscription recharge", "UPI/COUNTRY DELIGHT/countrydelight@ybl");
    if (m % 2 === 1) pay(D(12), SBI, "expenses:utilities:water", amount(420, 560), "BWSSB water bill", "UPI/BWSSB/bwssb@sbi");
    pay(D(4), SBI, "expenses:family:parents-support", 10000, "Monthly support to parents", "UPI/PARENTS/parents.sample@oksbi");
    txn(D(10), "PPF contribution", [["assets:investments:ppf", 5000, "TRANSFER TO PPF ACCOUNT"], [SBI, -5000]]);

    // Car loan EMI: interest on the outstanding principal at 9% a year.
    const emi = 14500;
    const interest = Math.round((carLoanOutstanding * 0.09) / 12);
    carLoanOutstanding -= emi - interest;
    txn(D(5), `Car loan EMI — ${label}`, [
      [CAR_LOAN, emi - interest, "EMI principal"],
      ["expenses:finance:loan-interest", interest, "EMI interest"],
      [HDFC, -emi],
    ], { narration: "ACH D- HDFC BANK CAR LOAN EMI" });

    // Investments
    const flexiCapSip = appraised ? 11000 : 10000;
    const indexSip = appraised ? 7000 : 6000;
    txn(D(7), "SIP — Parag Parikh Flexi Cap", [["assets:investments:mutual-funds:parag-parikh-flexi-cap", flexiCapSip, "ACH D- PPFAS MUTUAL FUND SIP"], [HDFC, -flexiCapSip]]);
    txn(D(7), "SIP — UTI Nifty 50 Index", [["assets:investments:mutual-funds:uti-nifty-50-index", indexSip, "ACH D- UTI MUTUAL FUND SIP"], [HDFC, -indexSip]]);
    txn(D(15), "NPS Tier I contribution", [["assets:investments:nps", 4000, "NPS TRUST CONTRIBUTION"], [HDFC, -4000]]);

    // Child
    if (quarterEnd) pay(D(5), HDFC, "expenses:child:school-fees", 24000, "Preschool quarterly fees", "NEFT/SAMPLE PRESCHOOL/QUARTERLY FEES");
    pay(D(8), HDFC, "expenses:child:activities", 2500, "Swimming and art classes", "UPI/KIDS ACTIVITY CENTRE/kidsclub.sample@okicici");

    // Utilities and subscriptions on the HDFC card
    const summer = [3, 4, 5].includes(m);
    pay(D(7), HCC, "expenses:utilities:electricity", summer ? amount(2300, 3100) : amount(1150, 1650), "BESCOM electricity bill", "BBPS BESCOM BANGALORE");
    pay(D(18), HCC, "expenses:utilities:internet", 1200, "ACT Fibernet", "ACT FIBERNET BANGALORE");
    pay(D(22), HCC, "expenses:utilities:mobile", 1050, "Airtel postpaid family plan", "AIRTEL POSTPAID");
    pay(D(9), HCC, "expenses:subscriptions:streaming", 650, "Netflix", "NETFLIX.COM");
    pay(D(15), HCC, "expenses:subscriptions:streaming", 180, "Spotify", "SPOTIFY INDIA");
    pay(D(20), HCC, "expenses:subscriptions:streaming", 300, "YouTube Premium family", "GOOGLE YOUTUBE PREMIUM");
    pay(D(24), HCC, "expenses:subscriptions:software", 2000, "ChatGPT Plus", "OPENAI CHATGPT SUBSCR");
    if (quarterEnd) pay(D(6), HCC, "expenses:health:fitness", 7500, "cult.fit quarterly membership", "CULTFIT CUREFIT HEALTHCARE");

    // Groceries: a big weekend shop on the card, quick commerce on UPI, and
    // vegetables in cash.
    const weekends = weekendDays(y, m);
    for (let i = 0; i < weekends.length; i += 2) {
      const store = pick(["BIGBASKET", "DMART READY", "DMART AVENUE SUPERMARTS", "MORE RETAIL"]);
      pay(D(weekends[i]), HCC, "expenses:food:groceries", amount(1500, 3000), `Groceries — ${store.split(" ")[0]}`, store);
      pay(D(weekends[i]), CASH, "expenses:food:groceries", amount(250, 600), "Vegetables and fruits", "Cash — vegetable market");
    }
    for (const d of randomDays(y, m, int(5, 8))) {
      const [name, vpa] = pick([["ZEPTO", "zepto@ybl"], ["BLINKIT", "blinkit@hdfcbank"], ["SWIGGY INSTAMART", "swiggy@icici"]]);
      pay(D(d), HDFC, "expenses:food:groceries", amount(180, 900), `Quick commerce — ${name}`, `UPI/${name}/${vpa}`);
    }

    // Eating
    for (const d of randomDays(y, m, int(6, 9))) {
      const [name, vpa] = pick([["Swiggy", "swiggy@icici"], ["Zomato", "zomato@hdfcbank"]]);
      pay(D(d), HDFC, "expenses:food:food-delivery", amount(220, 780), `${name} order`, `UPI/${name.toUpperCase()}/${vpa}`);
    }
    for (const d of randomDays(y, m, int(2, 3))) {
      const place = pick(["SAMPLE DARSHINI", "SAMPLE BIRYANI HOUSE", "SAMPLE BREWPUB", "SAMPLE COFFEE ROASTERS", "SAMPLE UDUPI RESTAURANT", "SAMPLE PIZZERIA"]);
      pay(D(d), HCC, "expenses:food:dining-out", amount(600, 2800), "Dining out", place);
    }

    // Getting around
    for (const d of randomDays(y, m, int(2, 3))) {
      pay(D(d), HCC, "expenses:transport:fuel", amount(1400, 2400), "Fuel", pick(["HPCL FUEL STATION", "BPCL FUEL STATION", "IOCL FUEL STATION", "SHELL INDIA"]));
    }
    for (const d of randomDays(y, m, int(4, 8))) {
      const [name, vpa] = pick([["Uber", "uber@axisbank"], ["Ola", "olacabs@ybl"], ["Rapido", "rapido@ybl"]]);
      pay(D(d), HDFC, "expenses:transport:cabs-autos", amount(90, 650), `${name} ride`, `UPI/${name.toUpperCase()}/${vpa}`);
    }
    for (const d of randomDays(y, m, int(1, 3))) pay(D(d), CASH, "expenses:transport:cabs-autos", amount(60, 200), "Auto rickshaw", "Cash — auto");
    pay(D(11), HDFC, "expenses:transport:metro", 500, "Namma Metro card recharge", "UPI/BMRCL/bmrcl@axisbank");
    pay(D(13), HDFC, "expenses:transport:car-maintenance", 600, "Car wash", "UPI/CAR WASH/carwash.sample@paytm");
    if (m % 2 === 1) pay(D(16), HDFC, "expenses:transport:tolls-parking", 1000, "FASTag recharge", "UPI/FASTAG RECHARGE/netc.fastag@hdfcbank");
    if (chance(0.6)) pay(D(int(1, 28)), CASH, "expenses:transport:tolls-parking", amount(40, 120), "Parking", "Cash — parking");

    // Health and personal care
    for (const d of randomDays(y, m, int(1, 2))) {
      const [name, vpa] = pick([["APOLLO PHARMACY", "apollopharmacy@icici"], ["MEDPLUS", "medplus@ybl"]]);
      pay(D(d), HDFC, "expenses:health:medicines", amount(250, 1300), "Pharmacy", `UPI/${name}/${vpa}`);
    }
    if (m % 3 === 1) pay(D(int(3, 25)), HDFC, "expenses:health:doctor-lab", 800, "Doctor consultation", "UPI/SAMPLE CLINIC/clinic.sample@okaxis");
    for (const d of randomDays(y, m, int(1, 2))) pay(D(d), HDFC, "expenses:personal:grooming", amount(300, 1400), "Salon", "UPI/SAMPLE SALON/salon.sample@okaxis");

    // Shopping on the Amazon Pay card
    for (const d of randomDays(y, m, int(1, 2))) pay(D(d), ICC, "expenses:shopping:household", amount(300, 2200), "Amazon — household", "AMAZON PAY INDIA");
    for (const d of randomDays(y, m, int(0, 1))) pay(D(d), ICC, "expenses:child:books-toys", amount(300, 1500), "Kids books and toys", pick(["AMAZON PAY INDIA", "FIRSTCRY BRAINBEES"]));
    if (chance(0.4)) pay(D(int(1, 28)), ICC, "expenses:personal:clothing", amount(900, 3800), "Clothing", pick(["MYNTRA DESIGNS", "AJIO RELIANCE RETAIL"]));

    // Leisure
    for (const d of randomDays(y, m, int(0, 2))) pay(D(d), HCC, "expenses:entertainment:movies", amount(650, 1300), "Movie tickets", pick(["BOOKMYSHOW", "PVR INOX"]));
    if (chance(0.5)) pay(D(int(1, 28)), CASH, "expenses:giving:donations", pick([100, 200, 500]), "Temple offering", "Cash — temple");

    // Card rewards and quarterly savings interest
    receive(D(25), HCC, "income:rewards:card-cashback", amount(250, 750), "HDFC card cashback", "CASHBACK CREDIT");
    receive(D(20), ICC, "income:rewards:card-cashback", amount(120, 450), "Amazon Pay card cashback", "AMAZON PAY CASHBACK");
    if (quarterEnd) {
      receive(D(31), HDFC, "income:interest:savings", amount(1900, 2800), "Savings interest", "CREDIT INTEREST CAPITALISED");
      receive(D(31), SBI, "income:interest:savings", amount(380, 560), "Savings interest", "INTEREST CREDIT");
    }
  }

  function yearlyEvents() {
    // A cooking gas cylinder every six weeks.
    for (let date = addDays(year.openingDate, 14); date <= year.lastPostedDate; date = addDays(date, 42)) {
      pay(date, SBI, "expenses:utilities:cooking-gas", 900, "LPG cylinder refill", "UPI/INDANE GAS/indane@sbi");
    }

    // Spending that mixes a parent account's sub-accounts, or fits none of
    // them, sits on the parent account itself.
    pay(on(9, 13), HDFC, "expenses:food", 450, "Bakery — bread, cake and snacks", "UPI/SAMPLE BAKERY/bakery.sample@okaxis");
    pay(on(12, 6), HCC, "expenses:food", 1500, "Snacks and drinks for a house party", "SAMPLE SUPERMARKET");
    pay(on(3, 7), CASH, "expenses:food", 400, "Sweets and savouries", "Cash — sweet shop");
    pay(on(6, 19), HDFC, "expenses:food", 1000, "Office cafeteria card top-up", "UPI/SAMPLE CAFETERIA/cafeteria.sample@okicici");
    pay(on(11, 8), ICC, "expenses:shopping", 2600, "Amazon order — kitchenware and a desk lamp", "AMAZON PAY INDIA");

    // September
    pay(on(9, 18), HCC, "expenses:travel:tickets", 6800, "Train tickets home for Diwali", "IRCTC E-TICKETING");
    txn(on(9, 21), "Group dinner, split with friends", [
      ["expenses:food:dining-out", 1600, "Own share"],
      [RECEIVABLES, 4800, "Friends' share"],
      [HCC, -6400],
    ]);
    receive(on(9, 23), HDFC, RECEIVABLES, 4800, "Friends settle dinner split", "UPI/SPLITWISE SETTLE UP");

    // October: Dussehra, the festival sale, Diwali
    pay(on(10, 1), CASH, "expenses:family:festivals", 1200, "Dussehra pooja items", "Cash — pooja store");
    pay(on(10, 3), ICC, "expenses:shopping:electronics", 43000, "New smartphone (festival sale)", "AMAZON PAY INDIA");
    pay(on(10, 8), HCC, "expenses:travel:tickets", 24600, "Flights to Goa", "INDIGO INTERGLOBE AVIATION");
    pay(on(10, 11), HCC, "expenses:transport:car-maintenance", 6800, "Car periodic service", "SAMPLE MOTORS SERVICE CENTRE");
    pay(on(10, 12), ICC, "expenses:personal:clothing", 14500, "Diwali clothes", "MYNTRA DESIGNS");
    pay(on(10, 15), SBI, "expenses:housing:house-help", 3500, "Diwali bonus — maid", "UPI/HOUSE HELP/maid.sample@oksbi");
    pay(on(10, 15), SBI, "expenses:housing:house-help", 5500, "Diwali bonus — cook", "UPI/COOK/cook.sample@oksbi");
    pay(on(10, 17), HDFC, "expenses:travel:local", 650, "Cab to railway station", "UPI/UBER/uber@axisbank");
    txn(on(10, 18), "Dhanteras gold coin", [["assets:investments:gold", 25000, "POS SAMPLE JEWELLERS"], [HDFC, -25000]]);
    pay(on(10, 19), HCC, "expenses:family:gifts", 6800, "Diwali sweets and gifts", "SAMPLE SWEETS AND GIFTS");
    pay(on(10, 20), CASH, "expenses:family:festivals", 2800, "Diyas, lights, and decorations", "Cash — Diwali market");
    pay(on(10, 23), HDFC, "expenses:travel:local", 600, "Cab home from station", "UPI/OLA/olacabs@ybl");
    txn(on(10, 28), "Funds added to Zerodha", [["assets:investments:stocks:zerodha", 25000, "NEFT/ZERODHA BROKING LTD"], [HDFC, -25000]]);

    // November
    receive(on(11, 6), HDFC, "income:dividends:stocks", 1150, "Infosys interim dividend", "ACH C- INFOSYS LTD INT DIV");
    pay(on(11, 12), HCC, "expenses:insurance:health", 26400, "Family floater health insurance", "SAMPLE HEALTH INSURANCE PREMIUM");
    pay(on(11, 15), HCC, "expenses:travel:stays", 31500, "Goa resort booking", "SAMPLE GOA BEACH RESORT");
    pay(on(11, 16), HDFC, "expenses:health:doctor-lab", 3200, "Child vaccination", "UPI/SAMPLE CHILDRENS CLINIC/clinic.sample@okaxis");
    pay(on(11, 22), HCC, "expenses:education:courses-books", 550, "Udemy course", "UDEMY");
    pay(on(11, 23), HDFC, "expenses:family:gifts", 5000, "Wedding gift", "UPI/WEDDING GIFT/cousin.sample@okicici");
    pay(on(11, 28), ICC, "expenses:shopping:electronics", 11500, "Air purifier", "AMAZON PAY INDIA");

    // December: an outing, Christmas, the Goa trip
    pay(on(12, 14), HCC, "expenses:entertainment:outings", 5000, "Wonderla day out", "WONDERLA HOLIDAYS");
    pay(on(12, 25), HCC, "expenses:family:gifts", 1850, "Christmas cake and gifts", "SAMPLE BAKERY");
    pay(on(12, 26), HDFC, "expenses:travel:local", 1150, "Cab to airport", "UPI/UBER/uber@axisbank");
    pay(on(12, 27), CASH, "expenses:travel:local", 2400, "Scooter rental in Goa", "Cash — scooter rental");
    pay(on(12, 27), HCC, "expenses:food:dining-out", 2850, "Dinner in Goa", "SAMPLE GOA SHACK");
    pay(on(12, 28), HCC, "expenses:travel:local", 3500, "Water sports in Goa", "SAMPLE WATER SPORTS");
    pay(on(12, 28), CASH, "expenses:food:dining-out", 1600, "Beach shack lunch", "Cash — beach shack");
    pay(on(12, 29), HCC, "expenses:food:dining-out", 3400, "Dinner in Goa", "SAMPLE GOA RESTAURANT");
    pay(on(12, 30), HDFC, "expenses:travel:local", 1100, "Cab home from airport", "UPI/OLA/olacabs@ybl");

    // January, including a loan to a friend, repaid two months later if that
    // is still within the seeded year
    const loanDate = on(1, 10);
    txn(loanDate, "Loan to a friend", [[RECEIVABLES, 10000, "UPI/LOAN TO FRIEND/friend.sample@okaxis"], [HDFC, -10000]]);
    const repaidOn = ymd(...addMonths(...yearMonth(loanDate), 2), 12);
    if (repaidOn <= year.lastPostedDate) receive(repaidOn, HDFC, RECEIVABLES, 10000, "Friend repays loan", "UPI/LOAN REPAYMENT/friend.sample@okaxis");
    pay(on(1, 14), CASH, "expenses:family:festivals", 1400, "Sankranti festival", "Cash — festival market");
    pay(on(1, 18), HDFC, "expenses:insurance:term-life", 16850, "Term life insurance premium", "ACH D- SAMPLE LIFE INSURANCE PREMIUM");
    pay(on(1, 19), ICC, "expenses:personal:clothing", 4200, "End-of-season sale", "AJIO RELIANCE RETAIL");
    pay(on(1, 24), HCC, "expenses:shopping:furniture", 15000, "Study table and chair", "IKEA INDIA");
    pay(on(1, 25), HDFC, "expenses:family:gifts", 11000, "Wedding gift", "UPI/WEDDING GIFT/friend.sample@okhdfcbank");

    // February
    txn(on(2, 3), "Funds added to Zerodha", [["assets:investments:stocks:zerodha", 20000, "NEFT/ZERODHA BROKING LTD"], [HDFC, -20000]]);
    pay(on(2, 8), HCC, "expenses:insurance:car", 17900, "Car insurance renewal", "SAMPLE GENERAL INSURANCE");
    pay(on(2, 10), ICC, "expenses:subscriptions:streaming", 1500, "Amazon Prime annual", "AMAZON PRIME");
    pay(on(2, 14), HDFC, "expenses:family:gifts", 5000, "Wedding gift", "UPI/WEDDING GIFT/colleague.sample@okicici");
    pay(on(2, 14), HCC, "expenses:food:dining-out", 3800, "Valentine's Day dinner", "SAMPLE FINE DINING");
    receive(on(2, 20), HDFC, "income:dividends:stocks", 1000, "Coal India interim dividend", "ACH C- COAL INDIA LTD DIV");
    pay(on(2, 21), HCC, "expenses:health:doctor-lab", 4200, "Annual health check-up", "SAMPLE DIAGNOSTICS");
    pay(on(2, 26), HCC, "expenses:education:courses-books", 4100, "Coursera specialisation", "COURSERA");

    // March: the opening FD matures, parents' insurance, financial year end
    pay(on(3, 14), HCC, "expenses:subscriptions:streaming", 1500, "JioHotstar annual", "JIOHOTSTAR");
    txn(on(3, 16), "Fixed deposit matured", [
      [HDFC, 160800],
      ["assets:deposits:hdfc-fixed-deposit", -150000, "FD maturity principal"],
      ["income:interest:fixed-deposit", -10800, "FD interest"],
    ], { narration: "FD MATURITY PROCEEDS" });
    pay(on(3, 19), HCC, "expenses:family:festivals", 2600, "Ugadi festival shopping", "SAMPLE SUPERMARKET");
    pay(on(3, 20), HDFC, "expenses:insurance:parents-health", 42500, "Parents' senior citizen health insurance", "NEFT/SAMPLE HEALTH INSURANCE");
    pay(on(3, 24), HCC, "expenses:giving:donations", 5000, "Donation to education charity", "SAMPLE CHARITY FOUNDATION");
    pay(on(3, 28), CASH, "expenses:transport:car-maintenance", 150, "Pollution check certificate", "Cash — PUC centre");
    const ppfInterestDate = on(3, 31);
    receive(ppfInterestDate, "assets:investments:ppf", "income:interest:ppf", 17000, `PPF interest for ${fyLabel(financialYear(...yearMonth(ppfInterestDate)))}`, "PPF INTEREST CREDIT");

    // April
    pay(on(4, 11), HCC, "expenses:transport:car-maintenance", 14200, "Car service and new battery", "SAMPLE MOTORS SERVICE CENTRE");
    pay(on(4, 15), HDFC, "expenses:finance:bank-charges", 600, "Debit card annual fee", "DEBIT CARD ANNUAL FEE INCL GST");
    txn(on(4, 19), "Akshaya Tritiya digital gold", [["assets:investments:gold", 15000, "UPI/DIGITAL GOLD/digigold.sample@ybl"], [HDFC, -15000]]);
    pay(on(4, 25), HDFC, "expenses:housing:repairs-maintenance", 1800, "AC servicing", "UPI/URBAN COMPANY/urbancompany@icici");

    // May: summer trip to Coorg
    pay(on(5, 2), CASH, "expenses:housing:repairs-maintenance", 650, "Plumber", "Cash — plumber");
    pay(on(5, 8), HDFC, "expenses:travel:stays", 16500, "Coorg homestay booking", "UPI/SAMPLE COORG HOMESTAY/homestay.sample@okaxis");
    pay(on(5, 15), HCC, "expenses:transport:fuel", 2900, "Fuel for Coorg trip", "HPCL FUEL STATION");
    pay(on(5, 16), HCC, "expenses:food:dining-out", 1850, "Lunch on the road", "SAMPLE HIGHWAY RESTAURANT");
    pay(on(5, 16), CASH, "expenses:travel:local", 1800, "Coffee estate tour", "Cash — estate tour");
    pay(on(5, 17), HCC, "expenses:food:dining-out", 2350, "Dinner in Madikeri", "SAMPLE MADIKERI RESTAURANT");
    pay(on(5, 17), CASH, "expenses:family:gifts", 1450, "Coffee and spices to take home", "Cash — spice shop");
    pay(on(5, 29), HDFC, "expenses:child:activities", 6500, "Summer camp", "UPI/SAMPLE SUMMER CAMP/camp.sample@okicici");

    // June: the school year starts, and the bonus for the last financial year
    pay(on(6, 5), HDFC, "expenses:child:school-fees", 18500, "Annual fees and books", "NEFT/SAMPLE PRESCHOOL/ANNUAL FEES");
    receive(on(6, 10), HDFC, "income:dividends:stocks", 1400, "Infosys final dividend", "ACH C- INFOSYS LTD FIN DIV");
    pay(on(6, 12), ICC, "expenses:child:books-toys", 4650, "School uniforms and books", "AMAZON PAY INDIA");
    receive(on(6, 26), HDFC, "income:dividends:stocks", 800, "ITC dividend", "ACH C- ITC LTD DIV");
    const juneYear = yearMonth(on(6, 1))[0];
    const bonusGross = 250000;
    const bonusTds = 78000;
    txn(ymd(juneYear, 6, lastWorkingDay(juneYear, 6)), `Performance bonus for ${fyLabel(financialYear(juneYear, 6) - 1)}`, [
      [HDFC, bonusGross - bonusTds],
      ["expenses:taxes:income-tax", bonusTds, "TDS on bonus"],
      ["income:salary:performance-bonus", -bonusGross, "Performance bonus"],
    ], { prio: 1, narration: "NEFT CR-SAMPLE TECHNOLOGIES PVT LTD-BONUS" });

    // July
    txn(on(7, 3), "Funds added to Zerodha", [["assets:investments:stocks:zerodha", 30000, "NEFT/ZERODHA BROKING LTD"], [HDFC, -30000]]);
    pay(on(7, 11), HCC, "expenses:health:doctor-lab", 6500, "Dental treatment", "SAMPLE DENTAL CLINIC");
    pay(on(7, 18), ICC, "expenses:personal:clothing", 3900, "End-of-season sale", "MYNTRA DESIGNS");
    receive(on(7, 20), HDFC, "income:dividends:stocks", 600, "HDFC Bank dividend", "ACH C- HDFC BANK LTD DIV");

    // August: last financial year's tax refund and EPF interest, a weekend
    // trip with friends. The refund's interest fits no sub-account of
    // income:interest, so it sits on that account itself.
    const lastFinancialYear = fyLabel(financialYear(...yearMonth(on(8, 1))) - 1);
    txn(on(8, 14), `Income tax refund for ${lastFinancialYear}`, [
      [HDFC, 8200],
      ["expenses:taxes:income-tax", -7800, "Refund"],
      ["income:interest", -400, "Interest on the refund"],
    ], { narration: "NEFT CR-CPC INCOME TAX REFUND" });
    pay(on(8, 22), HCC, "expenses:transport:car-maintenance", 5900, "Car periodic service", "SAMPLE MOTORS SERVICE CENTRE");
    receive(on(8, 25), "assets:investments:epf", "income:interest:epf", 58600, `EPF interest for ${lastFinancialYear}`, "EPFO INTEREST CREDIT");
    pay(on(8, 27), ICC, "expenses:family:gifts", 2500, "Raksha Bandhan gift", "AMAZON PAY INDIA");
    txn(on(8, 28), "Weekend villa with friends, split", [
      ["expenses:travel:stays", 4500, "Own share"],
      [RECEIVABLES, 13500, "Friends' share"],
      [HCC, -18000],
    ]);
    for (const day of [30, 30, 31]) receive(on(8, day), HDFC, RECEIVABLES, 4500, "Friend settles villa split", "UPI/SPLITWISE SETTLE UP");
  }

  /** Two rows in the as-of month's drafts that no rule can place. */
  function unrecognisedDrafts() {
    const day = (d) => ymd(year.asOfYear, year.asOfMonth, Math.min(d, Number(asOf.slice(8))));
    // The counterpart accounts only balance the transaction; the drafts are
    // left uncategorized.
    pay(day(6), HDFC, "expenses:food:groceries", 750, "Unrecognised UPI payment", "UPI/SAMPLE KIRANA STORE/paytmqr.sample@paytm", { uncategorized: true });
    receive(day(9), HDFC, RECEIVABLES, 2000, "Unrecognised IMPS credit", "IMPS CR/SAMPLE SENDER", { uncategorized: true });
  }

  /** Pay each card's month-end balance in full early the next month. */
  function cardPayments() {
    for (let i = 0; i <= 12; i++) {
      const [y, m] = addMonths(year.startYear, year.startMonth, i);
      const statementDate = endOfMonth(...addMonths(y, m, -1));
      for (const [card, day, description, narration] of [
        [HCC, 10, "HDFC credit card bill payment", "BILLPAY HDFC CREDIT CARD"],
        [ICC, 12, "ICICI credit card bill payment", "IMPS/ICICI CREDIT CARD PAYMENT"],
      ]) {
        const owed = -balanceOf(card, statementDate) / 100;
        if (owed > 0) txn(ymd(y, m, day), description, [[card, owed, narration], [HDFC, -owed]], { prio: 2 });
      }
    }
  }

  /** Withdraw cash from an HDFC ATM whenever the wallet would run dry. */
  function atmWithdrawals() {
    let cash = 0;
    for (const e of [...events].sort(byPostingOrder)) {
      const delta = e.postings.filter((p) => p.account === CASH).reduce((s, p) => s + p.paise, 0);
      if (delta < 0 && cash + delta < 500_00) {
        const rupees = Math.max(5000, Math.ceil((-(cash + delta) / 100 + 2000) / 1000) * 1000);
        txn(e.date, "ATM cash withdrawal", [[CASH, rupees, "ATM WDL HDFC BANK ATM"], [HDFC, -rupees]], { prio: e.prio - 1 });
        cash += rupees * 100;
      }
      cash += delta;
    }
  }

  /**
   * Keep about 3.5 lakh in HDFC savings as an emergency fund, and invest what
   * is above it in April (after the FD matures) and July (after the bonus).
   */
  function investSurplus() {
    const sweeps = [
      [on(4, 8), "Lump sum — UTI Nifty 50 Index", "assets:investments:mutual-funds:uti-nifty-50-index", "UPI/UTI MUTUAL FUND LUMPSUM/utimf@hdfcbank"],
      [on(7, 2), "Fixed deposit booked", "assets:deposits:hdfc-fixed-deposit", "FD BOOKING 12 MONTHS"],
    ].sort(([a], [b]) => a.localeCompare(b));
    for (const [date, description, account, narration] of sweeps) {
      const surplus = Math.floor((balanceOf(HDFC, date) / 100 - 350000) / 10000) * 10000;
      if (surplus >= 50000) txn(date, description, [[account, surplus, narration], [HDFC, -surplus]], { prio: 3 });
    }
  }

  openingBalances();
  for (let i = 0; i <= 12; i++) month(...addMonths(year.startYear, year.startMonth, i));
  yearlyEvents();
  unrecognisedDrafts();
  cardPayments();
  atmWithdrawals();
  investSurplus();
  events.sort(byPostingOrder);

  const posted = events.filter((e) => e.date <= year.lastPostedDate);
  // Only the as-of month's HDFC savings statement has been imported so far.
  const drafts = events.filter((e) => e.date > year.lastPostedDate && e.date <= asOf && e.postings.some((p) => p.account === HDFC));

  const { closing, lowest } = runningBalances(posted);
  const lowestWithDrafts = runningBalances([...posted, ...drafts]).lowest;
  for (const account of [HDFC, SBI, CASH]) {
    const low = Math.min(lowest.get(account), lowestWithDrafts.get(account));
    if (low < 0) throw new Error(`${account} dips to ${low / 100} in the year up to ${asOf}.`);
  }
  return { year, posted, drafts, closing, lowest };
}

function byPostingOrder(a, b) {
  return a.date.localeCompare(b.date) || a.prio - b.prio || a.seq - b.seq;
}

function runningBalances(events) {
  const closing = new Map();
  const lowest = new Map();
  for (const e of events) {
    for (const p of e.postings) {
      const balance = (closing.get(p.account) ?? 0) + p.paise;
      closing.set(p.account, balance);
      if (balance < (lowest.get(p.account) ?? Infinity)) lowest.set(p.account, balance);
    }
  }
  return { closing, lowest };
}

// ── Database ──────────────────────────────────────────────────────────────

/** Replaces the demo account's ledger with `posted` journals and `drafts`. */
function writeLedger(sqlite, scope, { posted, drafts }) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const rupees = (paise) => paise / 100;

  sqlite.transaction(() => {
    const where = "WHERE workspace_id = @workspaceId AND scoped_to_user_id = @userId";
    sqlite.prepare(`DELETE FROM draft_transactions ${where}`).run(scope);
    sqlite.prepare(`DELETE FROM journal_entries ${where}`).run(scope);
    sqlite.prepare(`DELETE FROM journals ${where}`).run(scope);
    sqlite.prepare(`UPDATE accounts SET parent_id = NULL ${where}`).run(scope);
    sqlite.prepare(`DELETE FROM accounts ${where}`).run(scope);

    const accountIds = new Map();
    const insertAccount = sqlite.prepare(`
      INSERT INTO accounts (workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
      VALUES (@workspaceId, @userId, @name, @parentId, @type, @now, @now)`);
    for (const { name, parent, type } of ACCOUNTS) {
      const parentId = parent === null ? null : accountIds.get(parent);
      const { lastInsertRowid } = insertAccount.run({ ...scope, name, parentId, type, now });
      accountIds.set(name, Number(lastInsertRowid));
    }

    // A statement account's last posting of each day asserts that day's
    // closing balance.
    const closingPosting = new Map();
    posted.forEach((e, i) =>
      e.postings.forEach((p, j) => {
        if (STATEMENT_ACCOUNTS.includes(p.account)) closingPosting.set(`${p.account}|${e.date}`, `${i}|${j}`);
      }),
    );

    const insertJournal = sqlite.prepare(`
      INSERT INTO journals (workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
      VALUES (@workspaceId, @userId, @date, @description, @now, @now)`);
    const insertEntry = sqlite.prepare(`
      INSERT INTO journal_entries (workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit,
                                   account_balance_assertion, comment, created_at, updated_at)
      VALUES (@workspaceId, @userId, @journalId, @accountId, @debit, @credit, @assertion, @comment, @now, @now)`);
    const balances = new Map();
    posted.forEach((e, i) => {
      const journalId = Number(insertJournal.run({ ...scope, date: e.date, description: e.description, now }).lastInsertRowid);
      e.postings.forEach((p, j) => {
        const balance = (balances.get(p.account) ?? 0) + p.paise;
        balances.set(p.account, balance);
        insertEntry.run({
          ...scope,
          journalId,
          accountId: accountIds.get(p.account),
          debit: p.paise > 0 ? rupees(p.paise) : 0,
          credit: p.paise < 0 ? rupees(-p.paise) : 0,
          assertion: closingPosting.get(`${p.account}|${e.date}`) === `${i}|${j}` ? rupees(balance) : null,
          comment: p.comment,
          now,
        });
      });
    });

    const insertDraft = sqlite.prepare(`
      INSERT INTO draft_transactions (workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit,
                                      account_id, base_account_id, balance_assertion_base_account, created_at, updated_at)
      VALUES (@workspaceId, @userId, @date, @narration, @withdrawal, @deposit, @accountId, @baseAccountId, @assertion, @now, @now)`);
    let hdfcBalance = balances.get(HDFC);
    drafts.forEach((e, i) => {
      const base = e.postings.find((p) => p.account === HDFC);
      const others = e.postings.filter((p) => p !== base);
      hdfcBalance += base.paise;
      // A draft has one category, so multi-leg transactions (the salary, the
      // EMI) stay uncategorized for the user to place.
      const account = others.length === 1 && !e.uncategorized ? others[0].account : null;
      insertDraft.run({
        ...scope,
        date: e.date,
        narration: e.narration,
        withdrawal: base.paise < 0 ? rupees(-base.paise) : 0,
        deposit: base.paise > 0 ? rupees(base.paise) : 0,
        accountId: account ? accountIds.get(account) : null,
        baseAccountId: accountIds.get(HDFC),
        assertion: drafts[i + 1]?.date !== e.date ? rupees(hdfcBalance) : null,
        now,
      });
    });
  })();
}

function openDatabase() {
  const dataDir = process.env.SAPPORTA_DATA_DIR;
  if (!dataDir) throw new Error("SAPPORTA_DATA_DIR is not set. Run this through pnpm seed, which loads .env.development.");
  const Database = createRequire(join(projectRoot, "packages/api/package.json"))("better-sqlite3");
  const sqlite = new Database(join(isAbsolute(dataDir) ? dataDir : resolve(projectRoot, dataDir), "sqlite.db"));
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

// ── Main ──────────────────────────────────────────────────────────────────

/** The as-of date from the command line, or today in India. */
function asOfArgument(args) {
  const date = args.find((arg) => arg !== "--") ?? new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
  if (!valid) throw new Error(`Expected an as-of date like 2027-01-15, got "${date}".`);
  return date;
}

/** Signs in to the demo account through the running API, creating it on the first run. */
async function signInDemoAccount() {
  const apiUrl = process.env.SAPPORTA_API_URL ?? `http://localhost:${process.env.SAPPORTA_API_PORT ?? 3000}`;
  const appOrigin = process.env.SAPPORTA_PUBLIC_APP_URL ?? apiUrl;
  if (!(await fetch(`${apiUrl}/health`).catch(() => null))) {
    throw new Error(`The API is not reachable at ${apiUrl}. Start it with pnpm dev.`);
  }
  const headers = { "content-type": "application/json", origin: appOrigin };
  let res = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password }),
  });
  if (res.status === 401) {
    res = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...DEMO_ACCOUNT, timeZone: TIME_ZONE }),
    });
  }
  if (!res.ok) throw new Error(`Could not sign up or sign in as ${DEMO_ACCOUNT.email}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  // Any authenticated /api request provisions the account's first workspace.
  await fetch(`${apiUrl}/api/openapi.json`, { headers: { cookie, origin: appOrigin } });
}

function demoWorkspaceScope(sqlite) {
  const scope = sqlite
    .prepare(`SELECT "user".id AS userId, member.organizationId AS workspaceId
              FROM "user" JOIN member ON member.userId = "user".id
              WHERE "user".email = ? ORDER BY member.createdAt LIMIT 1`)
    .get(DEMO_ACCOUNT.email);
  if (!scope) throw new Error(`${DEMO_ACCOUNT.email} has no workspace yet.`);
  return scope;
}

function printSummary({ year, posted, drafts, closing, lowest }) {
  const inr = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const total = (type) =>
    posted
      .filter((e) => e.date > year.openingDate)
      .reduce((sum, e) => sum + e.postings.filter((p) => ACCOUNT_TYPES.get(p.account) === type).reduce((s, p) => s + p.paise, 0), 0);

  console.log(`Seeded ${DEMO_ACCOUNT.email} (password: ${DEMO_ACCOUNT.password})`);
  console.log(`  Posted ${addDays(year.openingDate, 1)} to ${year.lastPostedDate}; HDFC savings drafts to ${year.asOf}`);
  console.log(`  ${ACCOUNTS.length} accounts, ${posted.length} journals, ${posted.reduce((n, e) => n + e.postings.length, 0)} entries, ${drafts.length} drafts`);
  console.log(`  Income ${inr(-total("Revenue"))}, expenses ${inr(total("Expense"))}`);
  console.log(`  Closing balances on ${year.lastPostedDate}:`);
  for (const account of [HDFC, SBI, CASH, HCC, ICC, CAR_LOAN, "assets:deposits:hdfc-fixed-deposit"]) {
    console.log(`    ${account.padEnd(42)} ${inr(closing.get(account)).padStart(12)}   (lowest ${inr(lowest.get(account))})`);
  }
}

if (import.meta.main) {
  const ledger = buildLedger(asOfArgument(process.argv.slice(2)));
  await signInDemoAccount();
  const sqlite = openDatabase();
  try {
    writeLedger(sqlite, demoWorkspaceScope(sqlite), ledger);
  } finally {
    sqlite.close();
  }
  printSummary(ledger);
}
