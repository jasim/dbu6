/*
 * Where an account sits in the tree, as the screens show it under its name:
 * the names of its parents from the top down, "Expenses > Kitchen". A top
 * account has none. The hierarchy comes only from `parent_id`, never from the
 * account's name.
 *
 * Every path comes from Sapporta's tree paths, so no screen walks the tree
 * once per row:
 *
 * - The accounts table's computed `parentPath` (`treePath()`), which
 *   Sapporta draws wherever it shows an account, and the frontend's
 *   `useAccountParentPaths` reads from one read of the accounts.
 * - Raw SQL joins `scoped_account_paths` (modules/ledger-sql), and
 *   `loadAccountParentPaths` reads it whole: the same paths, from Sapporta's
 *   `treePathRelation`.
 * - A report names an account in a column that references the accounts
 *   table (`accountNameColumn`), and Sapporta draws the table's computed
 *   `parentPath` under the name.
 */

/** What joins the names of a parent path, in TypeScript and in SQL. */
export const ACCOUNT_PATH_SEPARATOR = " > ";
