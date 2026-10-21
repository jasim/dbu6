import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LookupPickerItemProps } from "@sapporta/frontend/lookup";
import type { ReportCellRenderers } from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { cn } from "@sapporta/ui/cn";
import {
  accountParentPaths,
  parentPathColumnId,
  type PathAccount,
} from "../../shared/index";
import { accountChartQuery } from "../queries";

/*
 * An account's name as the screens show it outside the account tree: the
 * name, and under it, subtly, where it sits, "Expenses > Kitchen"
 * (`accountParentPaths`). Inside a tree, which shows the parents already, a
 * screen shows the name alone.
 *
 * Where the path comes from:
 * - a server read that carries `parent_path` beside the name, from
 *   `loadAccountParentPaths` or `scoped_account_paths`;
 * - a report column with its hidden `parentPathColumnId` sibling, which
 *   `accountPathCells` draws for every report screen;
 * - anything else, such as a Sapporta lookup or grid cell that only holds an
 *   account's id, or a screen that only has its name, through
 *   `useAccountParentPaths`: one cached read of the accounts per screen.
 */

/** An account's name, with its parent path under it when it has one. */
export function AccountName({
  name,
  parentPath,
  dense,
  className,
}: {
  name: ReactNode;
  /** "Expenses > Kitchen"; null or undefined for a top account. */
  parentPath: string | null | undefined;
  /** Smaller path text, for grid cells and other tight rows. */
  dense?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("block min-w-0", className)}>
      <span className="block truncate">{name}</span>
      {parentPath ? (
        <AccountParentPath path={parentPath} dense={dense} />
      ) : null}
    </span>
  );
}

/** The parent path alone, for a screen that places it under a name itself. */
export function AccountParentPath({
  path,
  dense,
  className,
}: {
  path: string;
  dense?: boolean;
  className?: string;
}) {
  return (
    <span
      title={path}
      className={cn(
        "block truncate font-normal text-ink-meta",
        dense ? "text-sap-micro leading-tight" : "text-meta",
        className,
      )}
    >
      {path}
    </span>
  );
}

/** Every account's parent path, looked up by its id or by its name. */
export interface AccountParentPaths {
  /** Null for a top account, and for one this screen hasn't read yet. */
  byId(id: number | null | undefined): string | null;
  /** By name, unique in a user's books, for reads that carry only names. */
  byName(name: string | null | undefined): string | null;
}

/**
 * The parent paths of every account in the books, from the accounts the edit
 * form's chart reads (`accountChartQuery`): one read, cached across screens
 * and refreshed with every change to an account (`refreshAccounts`).
 */
export function useAccountParentPaths(): AccountParentPaths {
  const { data } = useQuery(accountChartQuery);
  return useMemo(() => {
    const chart = (data ?? []).flatMap(pathAccount);
    const byId = accountParentPaths(chart);
    const byName = new Map(
      chart.map((account) => [account.name, byId.get(account.id) ?? null]),
    );
    return {
      byId: (id) => (id == null ? null : (byId.get(id) ?? null)),
      byName: (name) => (name == null ? null : (byName.get(name) ?? null)),
    };
  }, [data]);
}

/** A row of the accounts table as its parent path needs it; none if not one. */
function pathAccount(row: Record<string, unknown>): PathAccount[] {
  const { id, name, parent_id } = row;
  return typeof id === "number" &&
    typeof name === "string" &&
    (parent_id === null || typeof parent_id === "number")
    ? [{ id, name, parent_id }]
    : [];
}

/**
 * A `LookupPicker` choice from the accounts lookup: the account's label, with
 * its parent path under it. Pass as `itemDisplay={accountLookupItemDisplay}`.
 */
function AccountLookupItem({ entry }: LookupPickerItemProps) {
  const paths = useAccountParentPaths();
  return (
    <AccountName
      name={entry.label}
      parentPath={paths.byId(Number(entry.value))}
    />
  );
}

export const accountLookupItemDisplay = {
  fields: [],
  component: AccountLookupItem,
} as const;

/**
 * Cell renderers for every report column that has a hidden parent-path
 * sibling (`parentPathColumnId`): the name, with the path under it. Keyed as
 * `ReportCellRenderers` want, by level and column.
 */
export function accountPathCells(dataset: GridDataset): ReportCellRenderers {
  const cells: ReportCellRenderers = {};
  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const ids = new Set(level.columns.map((column) => column.id));
    for (const column of level.columns) {
      const pathId = parentPathColumnId(column.id);
      if (!ids.has(pathId)) continue;
      (cells[levelName] ??= {})[column.id] = ({ row, defaultContent }) => {
        const path = row.columns[pathId];
        return typeof path === "string" && path !== "" ? (
          <AccountName name={defaultContent} parentPath={path} dense />
        ) : (
          defaultContent
        );
      };
    }
  }
  return cells;
}
