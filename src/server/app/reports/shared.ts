import type { Context } from "hono";
import type { SapportaEnv } from "@sapporta/server";
import type { NavLink } from "@sapporta/shared/contracts";
import type {
  GridDataset,
  GridDatasetColumn,
  GridDatasetFooterRow,
} from "@sapporta/shared/grid-dataset";
import {
  readOnlyLedger,
  type LedgerAuth,
  type ReportLedger,
} from "../../modules/ledger-sql/index.js";
import { requireLedgerAuth } from "../workflow-auth.js";

export function authorizeReport(
  c: Context<SapportaEnv>,
  reportName: string,
): LedgerAuth {
  return requireLedgerAuth(c, (ability) =>
    ability.can("read", `reports:${reportName}`),
  );
}

/**
 * The signed-in user's books, for a report to read: the `scoped_*` relations
 * hold only their rows, and a statement that writes is refused. Forbidden
 * (403) unless the request may read `reports:<reportName>`, which an owner
 * always may. A project's report passes its own id, or nothing.
 */
export function reportLedger(
  c: Context<SapportaEnv>,
  reportName = "custom",
): ReportLedger {
  return readOnlyLedger(c.get("sqlite"), authorizeReport(c, reportName));
}

export function textColumn(
  id: string,
  label: string,
  options: Partial<GridDatasetColumn> = {},
): GridDatasetColumn {
  return { id, label, kind: "text", ...options };
}

export function dateColumn(
  id: string,
  label: string,
  options: Partial<GridDatasetColumn> = {},
): GridDatasetColumn {
  return { id, label, kind: "date", ...options };
}

export function moneyColumn(
  id: string,
  label: string,
  options: Partial<GridDatasetColumn> = {},
): GridDatasetColumn {
  return {
    id,
    label,
    kind: "number",
    displayFormat: "currency",
    ...options,
  };
}

export function percentColumn(
  id: string,
  label: string,
  options: Partial<GridDatasetColumn> = {},
): GridDatasetColumn {
  return {
    id,
    label,
    kind: "number",
    displayFormat: "percentage",
    ...options,
  };
}

export function hiddenIdColumn(id: string, label: string): GridDatasetColumn {
  return { id, label, kind: "number", visuallyHidden: true };
}

export function openRecordLink(
  table: string,
  source: string,
  label: string,
): NavLink {
  return {
    kind: "table",
    table,
    bind: { id: source },
    label,
    icon: "drill-up",
  };
}

export function accountLedgerLink(
  bind: Record<string, string>,
  label = "Open account ledger",
): NavLink {
  return {
    kind: "report",
    report: "account-ledger",
    bind,
    label,
    icon: "report",
  };
}

/** Month end for a `%Y-%m-01` month bucket, for date-bounded drill-downs. */
export function monthEnd(month: string): string {
  const [year = 0, monthNumber = 0] = month
    .split("-")
    .map((part) => Number(part));
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

export function flatResult<T extends Record<string, unknown>>(
  name: string,
  label: string,
  levelColumns: Record<string, GridDatasetColumn[]>,
  rows: T[],
  options: {
    rowKey: (row: T, index: number) => string;
    footerRows?: ReportFooterInput[];
    rowLinks?: NavLink[];
  },
): GridDataset {
  const levelName = Object.keys(levelColumns)[0]!;
  const columns = levelColumns[levelName]!;
  return {
    name,
    label,
    rootLevel: levelName,
    levels: {
      [levelName]: { columns, childLevels: [], rowLinks: options.rowLinks },
    },
    nodes: rows.map((row, index) => ({
      rowKey: options.rowKey(row, index),
      levelName,
      columns: row,
    })),
    footerRows: options.footerRows?.map((row) => footerRow(row, columns)),
  };
}

export type ReportFooterInput = {
  rowKey: string;
  label: string;
  columns: Record<string, unknown>;
};

export function footerRow(
  row: ReportFooterInput,
  columns: GridDatasetColumn[],
): GridDatasetFooterRow {
  const labelColumn = columns.find((column) => column.visuallyHidden !== true);
  return {
    rowKey: row.rowKey,
    columns: {
      ...(labelColumn ? { [labelColumn.id]: row.label } : {}),
      ...row.columns,
    },
  };
}

export function sum<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): number {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}
