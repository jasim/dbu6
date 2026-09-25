import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { Button } from "../../components/ui/button";
import type { FileStatus } from "./describeBatch";
import { OutcomeLine } from "./cards";
import { fileTypeLabel, formatFileSize } from "../../format";

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
        "rounded-card border-2 border-dashed px-4 py-5 text-center transition-colors duration-150 sm:p-6",
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

// The file type in a small tile. A dashed tile stands for a file not chosen;
// on a flagged row's grey, the tile turns white.
function TypeTile({
  label,
  chosen = true,
  onGrey = false,
}: {
  label: string;
  chosen?: boolean;
  onGrey?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[38px] shrink-0 items-center justify-center rounded-[10px] font-mono text-[11px] font-semibold",
        chosen
          ? cn(onGrey ? "bg-card" : "bg-tile-bg", "text-ink-soft")
          : "border border-dashed border-waiting-marker bg-waiting-bg text-ink-meta",
      )}
    >
      {label}
    </span>
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

const ROW = "flex items-center gap-3.5 px-4 py-2 sm:gap-[18px]";

/**
 * A chosen file: its type, name and size, and what became of it. A file with
 * a problem is `flagged`: its row turns into a muted header, and the problem
 * (`children`) sits under it.
 */
export function FileRow({
  file,
  status,
  note,
  flagged = false,
  disabled,
  onRemove,
  children,
}: {
  file: File;
  /** The outcome line, once the server has looked at the file. */
  status?: FileStatus | null;
  /** A quiet line saying what the file is for, when the list doesn't. */
  note?: ReactNode;
  flagged?: boolean;
  disabled: boolean;
  /** Absent once the import is done: the list is then a record. */
  onRemove?: () => void;
  children?: ReactNode;
}) {
  return (
    <li>
      <div className={cn(ROW, flagged && "bg-tile-bg")}>
        <TypeTile label={fileTypeLabel(file.name)} onGrey={flagged} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span
              title={file.name}
              className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-foreground"
            >
              {file.name}
            </span>
            <span className="tnum shrink-0 font-mono text-meta text-ink-meta">
              {formatFileSize(file.size)}
            </span>
          </div>
          {note && <p className="mt-0.5 text-meta text-ink-meta">{note}</p>}
          {status && (
            <OutcomeLine tone={status.tone} className="mt-0.5 text-meta">
              {status.text}
            </OutcomeLine>
          )}
        </div>
        {onRemove && (
          <RemoveButton
            fileName={file.name}
            disabled={disabled}
            onRemove={onRemove}
          />
        )}
      </div>
      {/* Aligned with the file name, except on a narrow screen. */}
      {children && (
        <div className="px-4 pb-1 pt-4 sm:pl-[76px] sm:pr-5">{children}</div>
      )}
    </li>
  );
}

/**
 * The optional Google Pay Takeout, in its own row under the statements. It
 * starts folded behind a plus, since most imports don't need it, and opens
 * to say why and how. It is added only here, never through the dropzone.
 */
export function GooglePayRow({
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
  if (file) {
    return (
      <FileRow
        file={file}
        note="Names from Google Pay"
        disabled={disabled}
        onRemove={onRemove}
      />
    );
  }
  return (
    <li>
      <details className="group/gpay">
        <summary
          className={cn(
            ROW,
            "cursor-pointer list-none outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden",
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-waiting-marker bg-waiting-bg text-ink-meta"
          >
            <Plus className="size-4 transition-transform duration-150 group-open/gpay:rotate-45" />
          </span>
          <span className="text-row font-semibold text-foreground">
            Names from Google Pay{" "}
            <span className="font-normal text-ink-meta">(optional)</span>
          </span>
        </summary>
        <div className="space-y-3 pb-4 pl-[68px] pr-4 text-meta text-ink-meta sm:pl-[76px] sm:pr-5">
          <p>
            If you use UPI often, your bank statements usually carry only UPI
            reference numbers, not the names of the other party. Those names are
            essential for automatic categorization. Upload your Google Pay
            activity here, and dbu6 will match each bank transaction against its
            UPI details from GPay and add the relevant information.
          </p>
          <p>
            To get the file, go to takeout.google.com and deselect everything
            except Google Pay. The export is usually ready within a few minutes.
            From the downloaded zip, upload the My Activity.html page, which
            holds the transaction details.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Choose file
          </Button>
        </div>
      </details>
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
    </li>
  );
}
