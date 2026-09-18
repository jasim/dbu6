// The transaction-identity module: the key each statement row is stored under,
// and the matchers that tell whether a draft and a stored transaction are the
// same one. Import from here rather than from the files.
export {
  assignSourceTransactionKeys,
  type TransactionIdentityInput,
} from "./transaction-identity.js";
export {
  matchDraftTransactions,
  matchTransactionToJournal,
  type JournalCandidate,
  type TransactionMatchType,
} from "./journal-transaction-matcher.js";
