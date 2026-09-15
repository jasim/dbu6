import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { Button } from "../../components/ui/button";
import type { FileStatus } from "./describeBatch";
import { OutcomeLine } from "./cards";
import { fileTypeLabel, formatFileSize } from "./format";

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
        "rounded-[18px] border-2 border-dashed px-5 py-8 text-center transition-colors duration-150 sm:p-[38px]",
        disabled
          ? "cursor-not-allowed border-waiting-border bg-waiting-bg"
          : dragging
            ? "border-primary bg-card"
            : "cursor-pointer border-sap-border-strong bg-dropzone-bg hover:bg-muted",
      )}
    >
      <div
        aria-hidden="true"
        className="mx-auto flex size-11 items-center justify-center rounded-[12px] bg-tile-bg text-[20px] text-ink-soft"
      >
        ↑
      </div>
      <p className="mt-3.5 text-[21px] font-semibold leading-tight text-foreground">
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

// The file type in a small tile. A dashed tile stands for a file not chosen.
function TypeTile({
  label,
  chosen = true,
}: {
  label: string;
  chosen?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[38px] shrink-0 items-center justify-center rounded-[10px] font-mono text-[11px] font-semibold",
        chosen
          ? "bg-tile-bg text-ink-soft"
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
      className="size-11 shrink-0 px-0 text-ink-meta hover:bg-muted hover:text-foreground disabled:text-waiting-marker"
    >
      <X />
    </Button>
  );
}

const ROW = "flex items-center gap-3.5 px-4 py-3 sm:gap-[18px] sm:px-5";

/** A chosen file: its type, name and size, and what became of it. */
export function FileRow({
  file,
  status,
  note,
  disabled,
  onRemove,
}: {
  file: File;
  /** The outcome line, once the server has looked at the file. */
  status?: FileStatus | null;
  /** A quiet line saying what the file is for, when the list doesn't. */
  note?: ReactNode;
  disabled: boolean;
  /** Absent once the import is done: the list is then a record. */
  onRemove?: () => void;
}) {
  return (
    <li className={ROW}>
      <TypeTile label={fileTypeLabel(file.name)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span
            title={file.name}
            className="min-w-0 flex-1 truncate text-[16.5px] font-semibold text-foreground"
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
    </li>
  );
}

/**
 * The optional Google Pay Takeout, in its own row under the statements. It
 * is added only here, never through the dropzone.
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
    <li className={cn(ROW, "flex-wrap gap-y-3 py-3.5")}>
      <TypeTile label="HTML" chosen={false} />
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-[16.5px] font-semibold text-foreground">
          Names from Google Pay{" "}
          <span className="font-normal text-ink-meta">(optional)</span>
        </p>
        <p className="mt-0.5 text-meta text-ink-meta">
          Add the activity page from your Google Pay Takeout, and UPI payments
          get the recipient's name before they're categorised.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="ml-auto"
      >
        Choose file
      </Button>
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
