import type {
  HledgerBooks,
  HledgerJournalFile,
  HledgerPosting,
  HledgerTransaction,
  Paise,
  RenderedFile,
} from "./model.js";

const MAIN_FILE = "main.journal";
const COMMODITY_DOCS =
  "https://hledger.org/1.29/hledger.html#commodity-directive";

/**
 * The books as hledger journal files, main.journal first: the commodity,
 * every account with its type, then an include for each file in order. The
 * books are already in hledger's terms, so this only prints them. A comment
 * after a name is two spaces away, since a single space can be part of it.
 */
export function renderHledgerBooks(books: HledgerBooks): RenderedFile[] {
  const main = [
    `commodity ${books.commodity}  ; ${COMMODITY_DOCS}`,
    "",
    ...books.accounts.map(
      (account) => `account ${account.name}  ; type: ${account.type}`,
    ),
    "",
    ...books.files.map((file) => `include ${file.path}`),
  ];
  return [
    { path: MAIN_FILE, content: lines(main) },
    ...books.files.map((file) => ({
      path: file.path,
      content: renderFile(file),
    })),
  ];
}

function renderFile(file: HledgerJournalFile): string {
  return lines([
    `; ${file.title}`,
    ...file.transactions.flatMap((transaction) => [
      "",
      ...renderTransaction(transaction),
    ]),
  ]);
}

function renderTransaction(transaction: HledgerTransaction): string[] {
  const tag =
    transaction.journalId === null
      ? ""
      : `  ; dbu6-id: ${transaction.journalId}`;
  const amounts = transaction.postings.map((posting) =>
    formatPaise(posting.amount),
  );
  const accountWidth = Math.max(
    ...transaction.postings.map((posting) => posting.account.length),
  );
  const amountWidth = Math.max(...amounts.map((amount) => amount.length));
  return [
    `${transaction.date} * ${transaction.description}${tag}`,
    ...transaction.postings.map((posting, index) =>
      renderPosting(posting, amounts[index]!, accountWidth, amountWidth),
    ),
  ];
}

// `    {account}  {amount}[ = {assertion}][  ; {comment}]`, the amounts
// right-aligned in one column. Two spaces end the account name.
function renderPosting(
  posting: HledgerPosting,
  amount: string,
  accountWidth: number,
  amountWidth: number,
): string {
  const assertion =
    posting.assertion === null ? "" : ` = ${formatPaise(posting.assertion)}`;
  const comment = posting.comment === null ? "" : `  ; ${posting.comment}`;
  return `    ${posting.account.padEnd(accountWidth)}  ${amount.padStart(amountWidth)}${assertion}${comment}`;
}

/**
 * Paise as `-?\d+\.\d{2}`: never grouped, so `1,000` can't be read as one
 * rupee, and in integers, so no float rounding creeps in.
 */
export function formatPaise(paise: Paise): string {
  const sign = paise < 0 ? "-" : "";
  const whole = Math.abs(paise);
  const rupees = Math.floor(whole / 100);
  const cents = String(whole % 100).padStart(2, "0");
  return `${sign}${rupees}.${cents}`;
}

function lines(text: readonly string[]): string {
  return `${text.join("\n")}\n`;
}
