import {
  accountTree,
  accountTreeLevel,
  accountTreeNodes,
  type AmountAccount,
  footerRow,
  type GridDataset,
  type GridDatasetNode,
  moneyColumn,
  textColumn,
} from "../../report-kit.js";

/**
 * An account in a report sectioned by account type, with the amount of its
 * own entries. Accounts without entries are kept at 0, so the tree keeps
 * their sub-accounts' parents.
 */
export type SectionAccount = AmountAccount & { account_type: string };

/**
 * One row per section, an account type, with its total; under it, the
 * section's accounts down the account tree, each with everything on and
 * below it (`accountTreeLevel`). A section shows its entry in `labels`, or
 * else the account type, which its row keeps in `account_type`.
 */
export function sectionAccountResult(input: {
  name: string;
  label: string;
  sections: string[];
  labels?: Record<string, string>;
  accounts: SectionAccount[];
}): GridDataset {
  const data = input.sections.map((section) => {
    const tree = accountTree(
      input.accounts.filter((account) => account.account_type === section),
    );
    return {
      rowKey: `section:${section}`,
      levelName: "section",
      columns: {
        section: input.labels?.[section] ?? section,
        account_type: section,
      },
      rollup: {
        section_total: tree.reduce((total, node) => total + node.total, 0),
      },
      children: {
        accounts: accountTreeNodes(tree, "accounts", (_account, amount) => ({
          balance: amount,
        })),
      },
    };
  });

  return {
    name: input.name,
    label: input.label,
    rootLevel: "section",
    levels: {
      section: {
        columns: [
          textColumn("account_type", "Account type", { visuallyHidden: true }),
          textColumn("section", "Section", {
            // Wide enough for the longest label, whole.
            width: Math.max(
              32,
              ...Object.values(input.labels ?? {}).map(
                (label) => label.length + 4,
              ),
            ),
          }),
          moneyColumn("section_total", "Total", { width: 18, strong: true }),
        ],
        childLevels: ["accounts"],
      },
      accounts: accountTreeLevel({
        nameWidth: 52,
        columns: [moneyColumn("balance", "Balance", { width: 18 })],
      }),
    },
    nodes: data,
  };
}

export function sectionTotal(
  nodes: GridDatasetNode[],
  section: string,
): number {
  const node = nodes.find((item) => item.columns.account_type === section);
  return Number(node?.rollup?.section_total ?? 0);
}

export function sectionFooterRow(input: {
  rowKey: string;
  label: string;
  columns: Record<string, unknown>;
  result: GridDataset;
}) {
  return footerRow(
    {
      rowKey: input.rowKey,
      label: input.label,
      columns: input.columns,
    },
    input.result.levels[input.result.rootLevel]!.columns,
  );
}
