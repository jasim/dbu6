import { Button } from "../components/ui/button";
import { formatMonth, joinNames, plural } from "../format";
import { Dropzone } from "../views/import-statements/files";
import { FocusCard, type FocusFrame } from "../components/focus-card";
import type { From } from "./state";

/**
 * Card 3: the account's statements, as many files as it takes, in any
 * order. Each drop is read at once. `held` is the set so far, when the user
 * came back to add to it.
 */
export function Drop({
  frame,
  from,
  held,
  onFiles,
  onBack,
}: {
  frame: FocusFrame;
  from: From;
  held: readonly File[];
  onFiles: (files: File[]) => void;
  /** Back to the card that sent the user to drop more. */
  onBack: () => void;
}) {
  const more = held.length > 0;
  return (
    <FocusCard
      {...frame}
      title={
        more
          ? "Drop the rest of its statements"
          : "Drop this account's statements"
      }
      lead={
        from.kind === "latest"
          ? "Its latest statement."
          : `Every statement from ${formatMonth(from.month)} to now, in any order.`
      }
      actions={
        more && (
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        )
      }
    >
      <Dropzone disabled={false} onFiles={onFiles} />
      {more && (
        <p className="mt-3 text-meta text-ink-meta [overflow-wrap:anywhere]">
          Dropped so far: {joinNames(held.map((file) => file.name))}
        </p>
      )}
    </FocusCard>
  );
}

/** While the dropped files are read. */
export function Reading({
  frame,
  files,
}: {
  frame: FocusFrame;
  files: number;
}) {
  return (
    <FocusCard
      {...frame}
      title="Reading your statements…"
      lead={<span role="status">{plural(files, "file")}</span>}
    />
  );
}

/** The read got no answer it could use. */
export function ReadFailed({
  frame,
  message,
  onRetry,
  onStartOver,
}: {
  frame: FocusFrame;
  message: string;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title="Couldn't read the statements"
      lead={
        <span role="alert" className="text-destructive">
          {message}
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onStartOver}>
            Use other files
          </Button>
          <Button onClick={onRetry}>Try again</Button>
        </>
      }
    />
  );
}
