import { Button } from "./ui/button";

/**
 * A screen's content that couldn't load: what was being loaded, the
 * backend's error word for word, and a way to try again.
 */
export function LoadError({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-card border border-sap-border bg-card px-5 py-[26px]"
    >
      <h2 className="text-heading text-foreground">{title}</h2>
      <p className="mt-[5px] text-body text-destructive [overflow-wrap:anywhere]">
        {message}
      </p>
      <Button className="mt-4" variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
