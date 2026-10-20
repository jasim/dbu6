import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Button } from "./ui/button";

/** Journals rendered as hledger text, as the server's hledger routes answer. */
export type RenderedHledger = {
  hledger_journal: string;
  journal_count: number;
};

/**
 * Rendered journals in a dialog, with a Copy button: open while there is a
 * result or an error to show. `description` says which journals they are;
 * `empty` is shown when there were none.
 */
export function HledgerDialog({
  result,
  error,
  description,
  empty,
  onClose,
}: {
  result: RenderedHledger | null;
  error: string | null;
  description: string;
  empty: string;
  onClose: () => void;
}) {
  const open = result !== null || error !== null;
  const text = result?.hledger_journal ?? "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[82vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>hledger journal</DialogTitle>
          <DialogDescription>
            {error ? "Render failed" : description}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-card border border-destructive/30 bg-destructive/10 p-3 text-row text-destructive">
            {error}
          </div>
        ) : text ? (
          <pre className="tnum max-h-[58vh] overflow-auto rounded-control bg-muted p-3 font-mono text-meta whitespace-pre">
            {text}
          </pre>
        ) : (
          <div className="rounded-card border p-3 text-row text-ink-meta">
            {empty}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(text)}
            waiting={text ? undefined : "Nothing to copy"}
          >
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
