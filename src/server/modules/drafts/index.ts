// The drafts module: draft rows from categorized statement rows, saving them
// and placing their balance assertions, loading them back categorized,
// reclassifying and clearing them, what an account's drafts hold, where
// they begin, and the lessons the user teaches the categoriser from them. Import
// from here rather than from the files.
export {
  partitionByCategorization,
  type CategorizedDraft,
  type DraftCategorizedTransaction,
} from "./DraftCategorizedTransaction.js";
export {
  loadCategorizedDrafts,
  type LoadedDrafts,
} from "./draft-categorization.js";
export {
  deleteAccountDrafts,
  loadDraftsById,
  saveReclassifiedDrafts,
  type ReclassifiedDraft,
  type SavedDraft,
} from "./draft-edits.js";
export {
  AssertionConflictError,
  persistDrafts,
  toDraftRows,
  type CategorizedStatementRow,
  type DraftRow,
  type PersistSummary,
} from "./draft-persistence.js";
export {
  countDraftsByAccount,
  countDraftsByBaseAccount,
} from "./account-drafts.js";
export {
  clearCategorizationLessons,
  deleteCategorizationLesson,
  insertCategorizationLesson,
  loadCategorizationLesson,
  loadCategorizationLessons,
  type NewCategorizationLesson,
} from "./categorization-lessons.js";
export { loadFirstDrafts, type FirstDrafts } from "./first-drafts.js";
export {
  draftCounts,
  findDraftDuplicates,
  findFailingChecks,
  loadDraftStatus,
  type DraftAccountStatus,
  type DraftStatusFilter,
  type FailingCheck,
} from "./draft-status.js";
