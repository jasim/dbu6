import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/*
 * What every form that is a route of its own shares. A form is opened in
 * front of the list it belongs to — by a click on a row, or by the list
 * redirecting to it for a link that named an account — so the list entry,
 * with its filters, its page and the row it was showing, is still behind it.
 */

/**
 * Where a form's Close goes.
 *
 * Stepping back leaves the list exactly as it was, and leaves no second copy
 * of it for Back to sit on. A form reached by its own link — the first entry
 * of the visit, with nothing behind it — goes to the list instead, keeping
 * whatever the form's URL was holding for it.
 */
export function useFormClose(listPath: string): () => void {
  const navigate = useNavigate();
  const { key, search } = useLocation();
  // React Router keys the entry a visit starts on "default"; every other
  // entry was made by navigating, so there is somewhere to step back to.
  const openedInFrontOfTheList = key !== "default";
  return useCallback(() => {
    if (openedInFrontOfTheList) void navigate(-1);
    else void navigate({ pathname: listPath, search }, { replace: true });
  }, [listPath, navigate, openedInFrontOfTheList, search]);
}
