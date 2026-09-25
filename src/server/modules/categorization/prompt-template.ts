/**
 * Scaffold for the LLM categorization prompt. llm-categorization.ts fills
 * `{accounts}` with the accounts `categorize` offers, from the ledger, and
 * `{custom_mapping}` with the instructions the account's import preset lists.
 */
export const PROMPT_TEMPLATE = `\
I want to add all my transactions into my accounting system. I have a list of transaction details from my bank statement, and a list of the account names in my books. Please return the account name that best matches each transaction.

Each input row has a "text" field containing the transaction description prefixed with "Expense:" or "Deposit:", and before that, in square brackets, the statement account: the bank or card account of mine whose statement the transaction is on. Classify each into the appropriate account from the list below, and answer with the account's name exactly as the list writes it.

Example input text: "[Checking] Expense: ATM Withdrawal at Main Street"
Example output: "Cash"

Example input text: "[Checking] Deposit: Salary from ABC Corp"
Example output: "Salary"

A mistake that happens now and then: a transaction from one bank's statement is filed under an account that belongs to a different bank, only because a word in the transaction's description also appears in that account's name.

The general rule: some of my accounts are tied to one bank or card, either its own account ("cc:bank-b") or one named after it ("expenses:emi-bank-b"). Use an account tied to a bank or card other than the statement account only for a transfer between the two.

Right: "[cc:bank-a] Deposit: CREDIT CARD PAYMENT BANK-B NETBANKING" → "assets:bank:bank-b". The bill of my Bank A card was paid from my Bank B account, so this is a transfer between the two.
Wrong: "[cc:bank-a] Expense: EMI PRINCIPAL 050505" → "expenses:emi-bank-b". The EMI is on my Bank A card, while "expenses:emi-bank-b" is for EMIs on my Bank B card; only the word "EMI" matches. The right answer is the account for what the EMI pays for, or an empty string if that isn't known.

If you can't find a valid mapping to one of my accounts, return an empty string for that transaction.

Here is the list of my accounts:

{accounts}

When categorizing, please follow the following custom mapping instructions:

{custom_mapping}

Do think before you classify - do not rush into classifying accounts you are not sure about. Do not generalize from concrete mapping instructions; for example: if I have said a specific company maps to a certain account, then do map that company to that account. But don't map other companies that you are not sure about. For specific groupings like Sharing, only map accounts that I have specifically told you.

For individual names that comes from UPI transactions, do not classify them unless you can confidently tell what it is. Do not use Miscellaneous as a catch-all bucket.

If you are not sure about classifying something, then return an empty string.

Pay attention to whether each transaction is marked as "Deposit" or "Expense" as this will help you categorize correctly. Deposits typically go to income accounts, while expenses go to expense accounts.
`;
