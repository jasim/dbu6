import type Database from "better-sqlite3";
import type { Context } from "hono";
import {
  forbidUnless,
  type SapportaAuthContext,
  type SapportaEnv,
} from "@sapporta/server";
import type { NavLink } from "@sapporta/shared/contracts";
import type {
  GridDataset,
  GridDatasetColumn,
  GridDatasetFooterRow,
} from "@sapporta/shared/grid-dataset";

export const ledgerCtes = `
WITH RECURSIVE
scoped_accounts AS (
  SELECT *
  FROM accounts
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
),
scoped_journals AS (
  SELECT *
  FROM journals
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
),
scoped_journal_entries AS (
  SELECT *
  FROM journal_entries
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
),
scoped_draft_transactions AS (
  SELECT *
  FROM draft_transactions
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
)`;

export type ScopeParams = {
  workspaceId: string;
  userId: string;
};

export function authorizeReport(
  c: Context<SapportaEnv>,
  reportName: string,
): ScopeParams {
  const auth = c.get("auth");
  forbidUnless(c, auth.ability.can("read", `reports:${reportName}`));
  const scope = workspaceUserScope(auth);
  forbidUnless(c, scope !== null);
  if (!scope) {
    throw new Error("Report requires workspace/user scoped data authority.");
  }
  return scope;
}

function workspaceUserScope(auth: SapportaAuthContext): ScopeParams | null {
  const scope = auth.dataAuthority.rowAuthorities.workspaceUserScoped;
  if (!scope) return null;
  return {
    workspaceId: scope.workspace.id,
    userId: scope.user.id,
  };
}

export function allRows<T>(
  sqlite: Database.Database,
  sql: string,
  params: Record<string, unknown>,
): T[] {
  return sqlite.prepare(sql).all(params) as T[];
}

export function oneRow<T>(
  sqlite: Database.Database,
  sql: string,
  params: Record<string, unknown>,
): T | null {
  return (sqlite.prepare(sql).get(params) as T | undefined) ?? null;
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
