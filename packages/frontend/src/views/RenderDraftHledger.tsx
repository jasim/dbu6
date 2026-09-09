import { useEffect, useState } from "react";
import { Loader2, FileText, AlertCircle } from "lucide-react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import { AppPage } from "@sapporta/frontend/shell";
import { draftTransactionsApi } from "../api";

interface RenderResult {
  hledger_journal: string;
  transaction_count: number;
  base_account: string;
}

export function RenderDraftHledger() {
  const accountLookup = useTableLookup("accounts");
  const [baseAccountId, setBaseAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (baseAccountId === null) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    draftTransactionsApi
      .renderDraftHledger({
        query: { base_account_id: Number(baseAccountId) },
      })
      .then((body) => setResult(body as RenderResult))
      .catch((e) => {
        setResult(null);
        setError(e instanceof Error ? e.message : "Failed to render drafts");
      })
      .finally(() => setLoading(false));
  }, [baseAccountId]);

  return (
    <AppPage section="Advanced" title="Render Draft Hledger">
      <div className="p-8 max-w-4xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Pick a base account to render its current{" "}
          <code>draft_transactions</code> as an hledger journal. Reflects the
          latest state after any manual edits or reclassification.
        </p>

        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1">
            <label
              htmlFor="render-draft-base-account"
              className="text-sm font-medium"
            >
              Base account
            </label>
            <LookupPicker
              id="render-draft-base-account"
              lookup={accountLookup}
              value={baseAccountId === null ? null : Number(baseAccountId)}
              onChange={(id) =>
                setBaseAccountId(id === null ? null : String(id))
              }
              placeholder="Select base account..."
              className="w-96"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-sm text-destructive/80 break-words">
              {error}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Rendering…
          </div>
        )}

        {result && !loading && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div className="text-sm font-medium">{result.base_account}</div>
                <div className="text-xs text-muted-foreground">
                  {result.transaction_count} draft
                  {result.transaction_count === 1 ? "" : "s"}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(result.hledger_journal)
                }
                disabled={!result.hledger_journal}
                className="text-xs rounded-md border px-2 py-1 hover:bg-nested disabled:opacity-50"
              >
                Copy
              </button>
            </div>
            {result.hledger_journal ? (
              <pre className="p-3 bg-nested rounded overflow-x-auto whitespace-pre font-mono text-xs">
                {result.hledger_journal}
              </pre>
            ) : (
              <div className="text-sm text-muted-foreground">
                No draft transactions for this base account.
              </div>
            )}
          </div>
        )}
      </div>
    </AppPage>
  );
}
