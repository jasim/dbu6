import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Button } from "./ui/button";

/*
 * A form's route that can't open its form, in the dialog chrome the form
 * itself uses. A form is a URL now, so a link can name a record that has
 * since gone, one this page won't change, or a read that failed — and the
 * URL still has to land somewhere that says so, rather than on a blank page.
 */
export function DialogNotice({
  title,
  message,
  onRetry,
  onClose,
}: {
  title: string;
  message?: string;
  /** Shown as "Try again"; left out when trying again can't help. */
  onRetry?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {message && (
          <p className="mt-3 text-body text-ink-meta [overflow-wrap:anywhere]">
            {message}
          </p>
        )}
        <DialogFooter className="mt-6">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {onRetry && (
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
