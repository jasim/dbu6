import type { TableSchema } from "@sapporta/shared/contracts";
import {
  conditionContentEqual,
  decodeFilters,
  encodeTypedFilters,
  materializeTypedFilterCondition,
  parseFiltersForTable,
  type FilterDraftCondition,
  type TypedFilterCondition,
} from "@sapporta/shared/filter";

const controlledColumns = ["account_id", "withdrawal"] as const;

export const draftTransactionQuickFilters = [
  {
    id: "under-200",
    label: "Uncategorized < 200",
    controlledColumns,
    conditions: [
      { column: "account_id", op: "is", polarity: "null" },
      { column: "withdrawal", op: "gt", value: "0" },
      { column: "withdrawal", op: "lt", value: "200" },
    ],
  },
  {
    id: "200-to-500",
    label: "Uncategorized 200–500",
    controlledColumns,
    conditions: [
      { column: "account_id", op: "is", polarity: "null" },
      { column: "withdrawal", op: "gte", value: "200" },
      { column: "withdrawal", op: "lte", value: "500" },
    ],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  controlledColumns: readonly string[];
  conditions: readonly FilterDraftCondition[];
}[];

export type DraftTransactionQuickFilterId =
  (typeof draftTransactionQuickFilters)[number]["id"];

export function findActiveDraftTransactionQuickFilter(
  searchParams: URLSearchParams,
  table: TableSchema,
): (typeof draftTransactionQuickFilters)[number] | undefined {
  const filters = parseFiltersForTable(decodeFilters(searchParams), table);

  return draftTransactionQuickFilters.find((preset) => {
    const ownedFilters = filters.filter((filter) =>
      preset.controlledColumns.includes(
        filter.column as (typeof preset.controlledColumns)[number],
      ),
    );
    const presetFilters = materializePresetFilters(preset, table);
    return conditionsMatchIgnoringOrder(ownedFilters, presetFilters);
  });
}

export function toggleDraftTransactionQuickFilter(
  id: DraftTransactionQuickFilterId,
  searchParams: URLSearchParams,
  table: TableSchema,
): URLSearchParams {
  const preset = draftTransactionQuickFilters.find(
    (candidate) => candidate.id === id,
  )!;
  const activePreset = findActiveDraftTransactionQuickFilter(
    searchParams,
    table,
  );
  const filters = parseFiltersForTable(decodeFilters(searchParams), table);
  const retainedFilters = filters.filter(
    (filter) =>
      !preset.controlledColumns.includes(
        filter.column as (typeof preset.controlledColumns)[number],
      ),
  );
  const nextFilters =
    activePreset?.id === id
      ? retainedFilters
      : [...retainedFilters, ...materializePresetFilters(preset, table)];
  const next = new URLSearchParams(searchParams);

  for (const key of [...next.keys()]) {
    if (key.startsWith("filter[")) next.delete(key);
  }
  for (const [key, value] of encodeTypedFilters(nextFilters)) {
    next.append(key, value);
  }
  next.delete("page");

  return next;
}

function materializePresetFilters(
  preset: (typeof draftTransactionQuickFilters)[number],
  table: TableSchema,
): TypedFilterCondition[] {
  return preset.conditions.map((condition) =>
    materializeTypedFilterCondition(condition, table),
  );
}

function conditionsMatchIgnoringOrder(
  actual: readonly TypedFilterCondition[],
  expected: readonly TypedFilterCondition[],
): boolean {
  if (actual.length !== expected.length) return false;

  const unmatched = [...actual];
  return expected.every((condition) => {
    const index = unmatched.findIndex((candidate) =>
      conditionContentEqual(candidate, condition),
    );
    if (index === -1) return false;
    unmatched.splice(index, 1);
    return true;
  });
}
