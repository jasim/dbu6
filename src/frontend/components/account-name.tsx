import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  defineRowDisplays,
  type LabelSlotProps,
} from "@sapporta/frontend/lookup";
import type { ReportCellRenderers } from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { cn } from "@sapporta/ui/cn";
import { parentPathColumnId } from "../../shared/index";
import { accountChartQuery } from "../queries";

/*
 * An account's name as the screens show it outside the account tree: the
 * name, and under it, subtly, where it sits, "Expenses > Kitchen". Inside a
 * tree, which shows the parents already, a screen shows the name alone.
 *
 * Where the path comes from:
 * - wherever Sapporta draws an account (grid cells at any level, pickers,
 *   forms, the record sheet), the accounts table's computed `parentPath`,
 *   drawn by `accountRowDisplays`;
 * - a server read that carries `parent_path` beside the name, from
 *   `loadAccountParentPaths` or `scoped_account_paths`;
 * - a report column with its hidden `parentPathColumnId` sibling, which
 *   `accountPathCells` draws for every report screen;
 * - a screen of dbu6's own that only has an account's id or name, through
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
  return data === undefined ? NO_PATHS : pathsOf(data);
}

type Chart = {
  rows: readonly Record<string, unknown>[];
  parentPaths: Readonly<Record<string, unknown>>;
};

const NO_PATHS: AccountParentPaths = { byId: () => null, byName: () => null };

// Each read of the chart, indexed by name once however many cells and
// choices on the screen ask for its paths.
const pathsByChart = new WeakMap<Chart, AccountParentPaths>();

function pathsOf(chart: Chart): AccountParentPaths {
  let paths = pathsByChart.get(chart);
  if (paths === undefined) {
    const pathOf = (id: unknown): string | null => {
      const path = chart.parentPaths[String(id)];
      return typeof path === "string" ? path : null;
    };
    const idByName = new Map(chart.rows.map((row) => [row.name, row.id]));
    paths = {
      byId: (id) => (id == null ? null : pathOf(id)),
      byName: (name) =>
        name == null || !idByName.has(name) ? null : pathOf(idByName.get(name)),
    };
    pathsByChart.set(chart, paths);
  }
  return paths;
}

/**
 * How Sapporta draws an account wherever it shows one: the name, with its
 * parent path under it, as `AccountName` draws it, at every grid level and in
 * every picker. A tree, which shows the parents, and a filter chip, which
 * has one line, keep the name alone; beside a picker's input, which shows
 * the name, the path alone.
 */
function AccountLabel({
  label,
  computed,
  context,
  defaultContent,
}: LabelSlotProps) {
  const path = computed.parentPath;
  if (typeof path !== "string" || path === "") return defaultContent;
  if (context.hierarchyShown || context.surface === "chip") {
    return defaultContent;
  }
  if (context.surface === "selected") return <AccountParentPath path={path} />;
  return (
    <AccountName
      // A cell's default is the name as the grid draws it, such as a link;
      // elsewhere the default already carries Sapporta's caption.
      name={context.surface === "cell" ? defaultContent : label}
      parentPath={path}
      dense={context.density === "compact"}
    />
  );
}

/** dbu6's row displays, for the `RowDisplayProvider` around the app. */
export const accountRowDisplays = defineRowDisplays({
  accounts: { label: { needs: ["parentPath"], render: AccountLabel } },
});

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
