import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage, commentWriterApi } from "../api";
import { plural } from "../format";
import type { CommentWriterStatus } from "../../shared/index";
import { commentWriterStatusQuery } from "../queries";

// While a notice is up and a run is going, the status is read this often, so
// the notice follows the run, a Retry's included, to its end.
const RUNNING_POLL_MS = 3000;

/**
 * One line, only when the comment writer has given up on some comments or
 * the coding agent isn't answering, with Retry. The drafts show their bank's
 * text meanwhile.
 */
export function CommentWriterNotice() {
  const queryClient = useQueryClient();
  const status = useQuery({
    ...commentWriterStatusQuery,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.running && noticeFor(data) !== null
        ? RUNNING_POLL_MS
        : false;
    },
  });
  const retry = useMutation({
    mutationFn: () => commentWriterApi.retryCommentWriter({ body: {} }),
    onSuccess: (next) =>
      queryClient.setQueryData(commentWriterStatusQuery.queryKey, next),
  });
  const shown = status.data;
  if (!shown) return null;
  const message = noticeFor(shown);
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

/** What the notice says, or null when there is nothing to say. */
function noticeFor(status: CommentWriterStatus): string | null {
  if (status.last_error !== null) return "Your coding agent isn't answering";
  if (status.failed > 0) {
    return `Couldn't write ${plural(status.failed, "comment")}`;
  }
  return null;
}
