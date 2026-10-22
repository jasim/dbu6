import {
  Fragment,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { AutoImportPlanFile } from "../../../shared/index";
import { cn } from "@sapporta/ui/cn";
import { statusTextClass } from "../../components/status-chip";
import { Button } from "../../components/ui/button";
import {
  describeFileAccount,
  type BatchCounts,
  type FileStatus,
} from "./describeBatch";
import { InfoButton } from "./cards";
import { formatDaySpan, plural } from "../../format";

/**
 * Opening /import with files already in its batch, from a screen that holds
 * them (/add's "already in your books"): the router's navigation state,
 * `navigate(IMPORT_ROUTE, { state: importWithFiles(files) })`. Nothing is
 * uploaded until the user presses Import.
 */
export const IMPORT_ROUTE = "/import";

export function importWithFiles(files: readonly File[]): { files: File[] } {
  return { files: [...files] };
}

/** The files /import was opened with, if any. */
export function carriedFiles(state: unknown): File[] {
  if (!state || typeof state !== "object" || !("files" in state)) return [];
  const { files } = state;
  return Array.isArray(files)
    ? files.filter((file): file is File => file instanceof File)
    : [];
}

/**
 * Where statements are dropped. Clicking anywhere in the zone opens the file
 * picker; "Choose files" is the keyboard path. Every file is taken: the
 * server says which ones it can't read.
 */
export function Dropzone({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function choose() {
    if (!disabled) input.current?.click();
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled && !dragging) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    // Moving onto a child element fires dragleave on the zone too.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) onFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      data-dropzone
      aria-disabled={disabled || undefined}
      onClick={choose}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "rounded-card border-2 border-dashed px-4 py-5 text-center sm:p-6",
        disabled
          ? "cursor-not-allowed border-waiting-border bg-waiting-bg"
          : dragging
            ? "border-primary bg-card"
            : "cursor-pointer border-sap-border-strong bg-dropzone-bg hover:bg-muted",
      )}
    >
      <div
        aria-hidden="true"
        className="mx-auto flex size-11 items-center justify-center rounded-[12px] bg-tile-bg text-[17px] text-ink-soft"
      >
        ↑
      </div>
      <p className="mt-3.5 text-[17px] font-semibold leading-tight text-foreground">
        Drop your statement files here
      </p>
      <p className="mt-1.5 text-row text-ink-meta">
        PDF, Excel or CSV. Add as many as you like.
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-4"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          choose();
        }}
      >
        Choose files
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}

function RemoveButton({
  fileName,
  disabled,
  onRemove,
}: {
  fileName: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Remove ${fileName}`}
      disabled={disabled}
      onClick={onRemove}
      className="size-(--height-sap-ctl) shrink-0 px-0 text-ink-meta hover:bg-muted hover:text-foreground disabled:text-waiting-marker"
    >
      <X />
    </Button>
  );
}

/** One dropped file as the table lists it. */
export interface StatementLine {
  key: string;
  file: File;
  /** What reading it found: the account, period and rows it holds. */
  row: AutoImportPlanFile | null;
  status: FileStatus;
  /** The step it needs next, or why the import refused it, under its line. */
  detail: ReactNode;
}

const CELL = "px-3 py-2 align-baseline";

/**
 * The dropped files, a line each: where each goes, the dates and rows it
 * holds, and its status, with any step a file needs right under it. The
 * foot counts what is ready and what is still to set up.
 */
export function StatementTable({
  lines,
  counts,
  disabled,
  onRemove,
  onClear,
}: {
  lines: readonly StatementLine[];
  counts: BatchCounts;
  disabled: boolean;
  onRemove: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-sap-border bg-card shadow-card">
      <table className="w-full text-row">
        <thead className="text-left text-meta text-ink-meta">
          <tr>
            <th scope="col" className={cn(CELL, "w-full pl-5 font-medium")}>
              Statement
            </th>
            <th
              scope="col"
              className={cn(CELL, "hidden font-medium sm:table-cell")}
            >
              Account
            </th>
            <th
              scope="col"
              className={cn(CELL, "hidden font-medium sm:table-cell")}
            >
              Period
            </th>
            <th
              scope="col"
              className={cn(
                CELL,
                "hidden text-right font-medium sm:table-cell",
              )}
            >
              Rows
            </th>
            <th scope="col" className={cn(CELL, "font-medium")}>
              Status
            </th>
            <th scope="col" className="py-2 pl-1 pr-3">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        {lines.map((line) => {
          const read = describeLine(line.row);
          return (
            <tbody key={line.key} className="border-t border-line-inner">
              <tr>
                {/* Takes the slack, and truncates a long name rather than
                    pushing the status off a phone's screen. */}
                <td className={cn(CELL, "max-w-0 pl-5")}>
                  <span
                    title={line.file.name}
                    className="block truncate font-semibold text-foreground"
                  >
                    {line.file.name}
                  </span>
                  {/* On a phone, the columns it drops. */}
                  {read.account && (
                    <span className="block truncate text-meta text-ink-meta sm:hidden">
                      {[read.account, read.period, read.rows]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    CELL,
                    "hidden max-w-40 truncate whitespace-nowrap text-ink-soft sm:table-cell",
                  )}
                >
                  {read.account ?? <span className="text-ink-meta">—</span>}
                </td>
                <td
                  className={cn(
                    CELL,
                    "hidden whitespace-nowrap text-ink-soft sm:table-cell",
                  )}
                >
                  {read.period ?? <span className="text-ink-meta">—</span>}
                </td>
                <td
                  className={cn(
                    CELL,
                    "tnum hidden text-right font-mono text-ink-soft sm:table-cell",
                  )}
                >
                  {read.transactions ?? (
                    <span className="text-ink-meta">—</span>
                  )}
                </td>
                <td
                  className={cn(
                    CELL,
                    "whitespace-nowrap font-medium",
                    statusTextClass(line.status.tone),
                  )}
                >
                  {line.status.text}
                </td>
                <td className="py-1 pl-1 pr-3 text-right align-middle">
                  <RemoveButton
                    fileName={line.file.name}
                    disabled={disabled}
                    onRemove={() => onRemove(line.file)}
                  />
                </td>
              </tr>
              {line.detail && (
                <tr>
                  <td colSpan={6} className="pb-4 pl-5 pr-4 pt-1">
                    {line.detail}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
        <tfoot className="border-t border-line-inner bg-sap-nested text-meta">
          <tr>
            <td colSpan={6} className="py-1.5 pl-5 pr-3">
              <div className="flex items-center justify-between gap-3">
                <BatchCountLine counts={counts} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={onClear}
                >
                  Clear all
                </Button>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// What reading a file found, for its line's columns.
function describeLine(row: AutoImportPlanFile | null): {
  account: string | null;
  period: string | null;
  transactions: number | null;
  rows: string | null;
} {
  if (row === null) {
    return { account: null, period: null, transactions: null, rows: null };
  }
  const transactions = "transactions" in row ? row.transactions : null;
  return {
    account: describeFileAccount(row),
    period:
      "period" in row && row.period
        ? formatDaySpan(row.period, { withYear: true })
        : null,
    transactions,
    rows: transactions === null ? null : plural(transactions, "row"),
  };
}

// "3 ready · 2 to set up · 127 rows", the parts there are.
function BatchCountLine({ counts }: { counts: BatchCounts }) {
  const parts = [
    counts.reading > 0 && (
      <span key="reading" className="text-ink-meta">
        {counts.reading} reading
      </span>
    ),
    counts.ready > 0 && (
      <span key="ready" className="text-primary">
        {counts.ready} ready
      </span>
    ),
    counts.setUp > 0 && (
      <span key="setup" className="text-attention-ink">
        {counts.setUp} to set up
      </span>
    ),
    counts.unread > 0 && (
      <span key="unread" className="text-destructive">
        {counts.unread} not read
      </span>
    ),
    counts.ready > 0 && (
      <span key="rows" className="text-ink-soft">
        {plural(counts.transactions, "row")}
      </span>
    ),
  ].filter(Boolean);
  return (
    <p className="tnum font-mono">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-ink-meta"> · </span>}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The optional Google Pay Takeout, an option of the whole batch rather than
 * one of its statements: it names the other party of every UPI payment in
 * the accounts imported. Added only here, never through the dropzone.
 */
export function GooglePayOption({
  file,
  disabled,
  onChoose,
  onRemove,
}: {
  file: File | null;
  disabled: boolean;
  onChoose: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby="gpay-title" className="space-y-3">
      <div className="space-y-1">
        <h2 id="gpay-title" className="text-subheading text-foreground">
          Payee names from Google Pay
        </h2>
        <p className="text-meta text-ink-meta">
          Banks often show only reference numbers for UPI payments. If you add
          your Google Pay activity, we can find the actual names.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-row">
        {file ? (
          <>
            <span
              title={file.name}
              className="min-w-0 truncate text-foreground"
            >
              {file.name}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onRemove}
            >
              Remove
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Add Google Pay details
          </Button>
        )}
        <InfoButton label="How to get your Google Pay activity">
          <p>
            If you use UPI often, your bank statements usually carry only UPI
            reference numbers, not the names of the other party. Those names are
            essential for automatic categorization. Add your Google Pay activity
            here, and dbu6 will match each bank transaction against its UPI
            details from GPay and add the relevant information.
          </p>
          <p>
            To get the file, go to takeout.google.com and deselect everything
            except Google Pay. The export is usually ready within a few minutes.
            From the downloaded zip, add the My Activity.html page, which holds
            the transaction details.
          </p>
        </InfoButton>
        <input
          ref={input}
          type="file"
          accept=".html,.htm"
          hidden
          disabled={disabled}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onChoose(chosen);
            event.target.value = "";
          }}
        />
      </div>
    </section>
  );
}
