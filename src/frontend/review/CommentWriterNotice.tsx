import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, commentWriterApi } from "../api";
import { plural } from "../format";
import { commentWriterStatusQuery } from "../queries";

/**
 * One line, only when the comment writer has given up on some comments or
 * the coding agent isn't answering, with Retry. The drafts show their bank's
 * text meanwhile.
 */
export function CommentWriterNotice() {
  const queryClient = useQueryClient();
  const status = useQuery(commentWriterStatusQuery);
  const retry = useMutation({
    mutationFn: () => commentWriterApi.retryCommentWriter({ body: {} }),
    onSuccess: (next) =>
      queryClient.setQueryData(commentWriterStatusQuery.queryKey, next),
  });
  const shown = retry.data ?? status.data;
  if (!shown) return null;
  const message =
    shown.last_error !== null
      ? "Your coding agent isn't answering"
      : shown.failed > 0
        ? `Couldn't write ${plural(shown.failed, "comment")}`
        : null;
  if (message === null) return null;
  return (
    <p
      role="status"
      title={shown.last_error ?? undefined}
      className="flex flex-wrap items-baseline gap-x-2 border-b border-sap-border px-3 py-1.5 text-meta text-ink-soft sm:px-4"
    >
      {message}
      <span aria-hidden="true" className="text-ink-meta">
        ·
      </span>
      <button
        type="button"
        onClick={() => retry.mutate()}
        disabled={retry.isPending || shown.running}
        className="font-semibold text-primary hover:underline disabled:opacity-50"
      >
        Retry
      </button>
      {retry.isError && (
        <span className="text-destructive">{apiErrorMessage(retry.error)}</span>
      )}
    </p>
  );
}
