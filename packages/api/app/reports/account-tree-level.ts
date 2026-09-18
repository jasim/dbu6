import type {
  GridDatasetColumn,
  GridDatasetLevel,
  GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
import type { AccountNode, AmountAccount } from "../account-tree.js";
import { hiddenIdColumn, openRecordLink, textColumn } from "./shared.js";

/*
 * Accounts down the account tree (`accountTree`, by `parent_id`) as one
 * report level that Sapporta shows as a tree. An account's row carries
 * everything on and below it. A parent that has entries of its own as well
 * as sub-accounts gets one more row, last under it, for those entries, so
 * its children add up to its row and every entry shows once. That row has
 * no links, as on the Income and Expenses page: the parent's ledger takes
 * in its sub-accounts.
 */

/** The hidden column holding the row key of a row's parent in the tree. */
const PARENT_KEY = "parent_key";

/**
 * A tree level with the account's name, where the tree shows, and then
 * `columns`. Rows link to their account.
 */
export function accountTreeLevel(input: {
  nameWidth: number;
  columns: GridDatasetColumn[];
}): GridDatasetLevel {
  return {
    columns: [
      hiddenIdColumn("account_id", "Account ID"),
      { id: PARENT_KEY, label: "Parent", kind: "text", visuallyHidden: true },
      textColumn("name", "Account", { width: input.nameWidth }),
      ...input.columns,
    ],
    childLevels: [],
    tree: { parentColumn: PARENT_KEY, column: "name" },
    rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
  };
}

/**
 * The rows of an `accountTreeLevel` for `nodes`, parents before children, in
 * the tree's order. `columns` gives the rest of a row's values from its
 * account and its amount: the account's total, or a parent's own amount on
 * the row for its own entries.
 */
export function accountTreeNodes<T extends AmountAccount>(
  nodes: readonly AccountNode<T>[],
  levelName: string,
  columns: (account: T, amount: number) => Record<string, unknown>,
): GridDatasetNode[] {
  const rows = (
    node: AccountNode<T>,
    parentKey: string | null,
  ): GridDatasetNode[] => {
    const { account } = node;
    const rowKey = `account:${account.account_id}`;
    const ownEntries =
      node.children.length > 0 && node.own !== 0
        ? [
            {
              rowKey: `${rowKey}:own`,
              levelName,
              columns: {
                [PARENT_KEY]: rowKey,
                name: `${account.name}, not in a sub-account`,
                ...columns(account, node.own),
              },
            },
          ]
        : [];
    return [
      {
        rowKey,
        levelName,
        columns: {
          account_id: account.account_id,
          [PARENT_KEY]: parentKey,
          name: account.name,
          ...columns(account, node.total),
        },
      },
      ...node.children.flatMap((child) => rows(child, rowKey)),
      ...ownEntries,
    ];
  };
  return nodes.flatMap((node) => rows(node, null));
}
