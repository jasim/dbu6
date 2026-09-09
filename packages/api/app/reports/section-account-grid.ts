import type {
  GridDataset,
  GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
import {
  footerRow,
  hiddenIdColumn,
  moneyColumn,
  openRecordLink,
  sum,
  textColumn,
} from "./shared.js";

export type SectionAccountRow = {
  section: string;
  account_id: number;
  name: string;
  balance: number;
};

export function sectionAccountResult(input: {
  name: string;
  label: string;
  sections: string[];
  rows: SectionAccountRow[];
}): GridDataset {
  const levelColumns = {
    section: [
      textColumn("section", "Section", { width: 32 }),
      moneyColumn("section_total", "Total", { width: 18, strong: true }),
    ],
    accounts: [
      hiddenIdColumn("account_id", "Account ID"),
      textColumn("name", "Account", { width: 52 }),
      moneyColumn("balance", "Balance", { width: 18 }),
    ],
  };
  const data = input.sections.map((section) => {
    const accountRows = input.rows.filter((row) => row.section === section);
    const children = accountRows.map((row) => ({
      rowKey: `account:${row.account_id}`,
      levelName: "accounts",
      columns: row,
    }));
    return {
      rowKey: `section:${section}`,
      levelName: "section",
      columns: { section },
      rollup: { section_total: sum(accountRows, "balance") },
      children: { accounts: children },
    };
  });

  return {
    name: input.name,
    label: input.label,
    rootLevel: "section",
    levels: {
      section: { columns: levelColumns.section, childLevels: ["accounts"] },
      accounts: {
        columns: levelColumns.accounts,
        childLevels: [],
        rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
      },
    },
    nodes: data,
  };
}

export function sectionTotal(
  nodes: GridDatasetNode[],
  section: string,
): number {
  const node = nodes.find((item) => item.columns.section === section);
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
