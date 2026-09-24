// What a report's screen is written against: the report half of
// `dbu6/frontend`, which re-exports every name here (index.ts), so a
// project's screen and ours are written against the same list. A name is
// added on purpose: it is promised across versions.
//
// Our own report screens import this module and nothing else, not even
// React (scripts/import-boundaries.test.mjs): a project has one dependency,
// so whatever a screen of ours reaches for, a project's must find here. They
// import this file rather than index.ts because index.ts also exports
// `startDbu6Frontend`, which imports the screens: through this module there
// is no cycle. Keep it free of anything that imports a report screen.

// --- React, the router and the query client, in the one copy the app runs ---
export {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
export {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
export {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

// --- The report's own contract, called from the screen ---
export { reportClient, apiErrorMessage } from "./api";
export { FRESH_QUERY } from "./queries";
export type { GridDataset } from "@sapporta/shared/grid-dataset";

// --- The frame, the toolbar and the grid ---
export {
  ReportRunButton,
  ReportScreenFrame,
  ReportToolbar,
  type ReportCellLink,
  type ReportCellLinkContext,
  type ReportCellLinkResolvers,
  type ReportCellRenderContext,
  type ReportCellRenderers,
} from "@sapporta/frontend/report";
export {
  DateInput,
  ReportResultBody,
  today,
  useReportResult,
} from "./reports/shared";
export { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
export type { LookupValue } from "@sapporta/grid/lookup";
export { usePageTitle } from "@sapporta/frontend/shell";

// --- Periods ---
export {
  ReportPeriodField,
  useReportPeriod,
} from "./reports/ReportPeriodField";
export {
  reportDates,
  type ReportDates,
  type ReportPeriod,
} from "./reports/report-period";
export {
  PERIOD_PRESETS,
  financialYearOf,
  financialYearSpan,
  monthEnd,
  parsePreset,
  parseSpan,
  presetLabel,
  presetSpan,
  type PeriodPreset,
} from "./reports/periods";
export type { DateSpan } from "../shared/index";
export { Temporal } from "@sapporta/shared/temporal";

// --- Links into the account ledger and the income statement ---
export {
  accountLedgerHref,
  accountLedgerRow,
  incomeStatementHref,
  type LedgerLinkInput,
} from "./reports/links";

// --- Formatters ---
export {
  agree,
  formatDate,
  formatDateRange,
  formatDaySpan,
  formatMoney,
  formatMonth,
  formatMonthSpan,
  formatShortDate,
  monthName,
  plural,
} from "./format";
export { Amount, formatAmount, type Direction } from "./components/amount";

// --- Blocks for a screen that is not a grid ---
export { Screen, ScreenTitle } from "./components/screen";
export { EmptyState } from "./components/empty-state";
export { LoadError } from "./components/load-error";
export { Button } from "./components/ui/button";
export {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "./components/ui/select";
export {
  ToggleGroup,
  ToggleGroupItem,
  togglePillClassName,
} from "./components/ui/toggle-group";
export {
  accountHue,
  categoryHueColor,
  type CategoryHueKey,
} from "./components/category";
export { cn } from "@sapporta/ui/cn";
export { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
export { Tooltip, TooltipContent, TooltipTrigger } from "@sapporta/ui/tooltip";
export { ChevronRight } from "lucide-react";

// --- What report.ts and frontend.tsx default-export ---
export type { ReportDefinition } from "./reports/registry";
export type { Dbu6FrontendExtension, Dbu6Page } from "./extension";
export type { NavigationItem } from "./shell/navigation";
