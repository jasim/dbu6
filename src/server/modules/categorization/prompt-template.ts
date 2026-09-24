/**
 * Scaffold for the LLM categorization prompt. llm-categorization.ts fills
 * `{accounts}` with the accounts `categorize` offers, from the ledger, and
 * `{custom_mapping}` with the instructions the account's import preset lists.
 */
export const PROMPT_TEMPLATE = `\
I want to add all my transactions into my accounting system. I have a list of transaction details from my bank statement, and a list of the account names in my books. Please return the account name that best matches each transaction.

Each input row has a "text" field containing the transaction description prefixed with "Expense:" or "Deposit:". Classify each into the appropriate account from the list below, and answer with the account's name exactly as the list writes it.

Example input text: "Expense: ATM Withdrawal at Main Street"
Example output: "Cash"

Example input text: "Deposit: Salary from ABC Corp"
Example output: "Salary"

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
