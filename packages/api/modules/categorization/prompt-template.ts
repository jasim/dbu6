/**
 * Scaffold for the LLM categorization prompt. llm-categorization.ts fills
 * `{hledger_accounts}` with the accounts `categorize` offers, from the
 * ledger, and `{custom_mapping}` with the preset's instructions.
 */
export const PROMPT_TEMPLATE = `\
I want to add all my transactions into my accounting system that includes an hledger plain-text bookkeeping journal file. I have a list of transaction details from my bank statement, and a list of account names that I use in my hledger. Please return the hledger account name that best matches each transaction.

Each input row has a "text" field containing the transaction description prefixed with "Expense:" or "Deposit:". Classify each into the appropriate hledger account from the list below.

Example input text: "Expense: ATM Withdrawal at Main Street"
Example output: "expenses:cash"

Example input text: "Deposit: Salary from ABC Corp"
Example output: "income:salary"

If you can't find a valid mapping to my hledger account, return an empty string for that transaction.

Here is the list of my accounts from hledger:

{hledger_accounts}

When categorizing, please follow the following custom mapping instructions:

{custom_mapping}

Do think before you classify - do not rush into classifying accounts you are not sure about. Do not generalize from concrete mapping instructions; for example: if I have said a specific company maps to a certain account, then do map that company to that account. But don't map other companies that you are not sure about. For specific groupings like expenses:sharing, only map accounts that I have specifically told you.

For individual names that comes from UPI transactions, do not classify them unless you can confidently tell what it is. Do not use expenses:misc as a catch-all bucket.

If you are not sure about classifying something, then return an empty string.

Pay attention to whether each transaction is marked as "Deposit" or "Expense" as this will help you categorize correctly. Deposits typically go to income accounts, while expenses go to expense accounts.
`;
