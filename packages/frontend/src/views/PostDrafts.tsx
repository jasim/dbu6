import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, AlertCircle, CheckCircle2 } from "lucide-react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import { draftTransactionsApi, reportsApi } from "../api";
import { Link } from "react-router-dom";

interface Account {
  id: number;
  name: string;
}

interface Counts {
  drafts: number;
  uncategorized: number;
  failing: number;
  duplicates: number;
}

interface PostResult {
  base_account: string;
  journals_created: number;
  entries_created: number;
  drafts_posted: number;
}

async function fetchTotal(url: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { meta?: { total?: number } };
  return body.meta?.total ?? 0;
}

export function PostDrafts() {
  const accountLookup = useTableLookup("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [baseAccountId, setBaseAccountId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/tables/accounts?limit=1000&sort=name`)
      .then((r) => r.json())
      .then((body: { data: Account[] }) => setAccounts(body.data))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load accounts"),
      );
  }, []);

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a.id) === baseAccountId) ?? null,
    [accounts, baseAccountId],
  );

  const loadCounts = useCallback(async () => {
    if (baseAccountId === null || selectedAccount === null) {
      setCounts(null);
      return;
    }
    setLoadingCounts(true);
    setError(null);
    try {
      const base = getApiBase();
      const idFilter = `filter[base_account_id][eq]=${baseAccountId}`;
      const [drafts, uncategorized, report, duplicateReport] =
        await Promise.all([
          fetchTotal(`${base}/tables/draft_transactions?${idFilter}&limit=1`),
          fetchTotal(
            `${base}/tables/draft_transactions?${idFilter}&filter[account_id][is]=null&limit=1`,
          ),
          reportsApi.draftBalanceAssertions({ query: {} }),
          reportsApi.duplicateDrafts({ query: {} }),
        ]);
      const failing = report.nodes.filter(
        (n) => n.columns.account_name === selectedAccount.name,
      ).length;
      const duplicates = duplicateReport.nodes.filter(
        (node) => node.columns.base_account === selectedAccount.name,
      ).length;
      setCounts({ drafts, uncategorized, failing, duplicates });
    } catch (e) {
      setCounts(null);
      setError(e instanceof Error ? e.message : "Failed to load counts");
    } finally {
      setLoadingCounts(false);
    }
  }, [baseAccountId, selectedAccount]);

  useEffect(() => {
    setResult(null);
    loadCounts();
  }, [loadCounts]);

  async function handlePost() {
    if (baseAccountId === null) return;
    setPosting(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await draftTransactionsApi.postDraftsToJournal({
          body: { base_account_id: Number(baseAccountId) },
        }),
      );
      await loadCounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post drafts");
    } finally {
      setPosting(false);
    }
  }

  const canPost =
    baseAccountId !== null &&
    counts !== null &&
    !loadingCounts &&
    !posting &&
    counts.drafts > 0 &&
    counts.uncategorized === 0 &&
    counts.duplicates === 0 &&
    counts.failing === 0;

  return (
    <AppPage section="Finish" title="Post reviewed entries">
      <div className="p-8 max-w-4xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Choose a bank or card account to make its draft part of the books.
          Posting creates the journals and balanced journal entries used by your
          ledgers and reports. The final button stays locked until every draft
          is categorized and the duplicate and balance checks pass.
        </p>

        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1">
            <label
              htmlFor="post-drafts-base-account"
              className="text-sm font-medium"
            >
              Account being posted
            </label>
            <LookupPicker
              id="post-drafts-base-account"
              lookup={accountLookup}
              value={baseAccountId === null ? null : Number(baseAccountId)}
              onChange={(id) =>
                setBaseAccountId(id === null ? null : String(id))
              }
              placeholder="Select a bank or credit card account..."
              className="w-96"
            />
          </div>
        </div>

        {baseAccountId !== null && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Duplicate overlaps"
              value={counts?.duplicates}
              loading={loadingCounts}
              tone={counts && counts.duplicates > 0 ? "warn" : "ok"}
            />
            <StatCard
              label="Draft transactions"
              value={counts?.drafts}
              loading={loadingCounts}
            />
            <StatCard
              label="Uncategorized"
              value={counts?.uncategorized}
              loading={loadingCounts}
              tone={counts && counts.uncategorized > 0 ? "warn" : "ok"}
            />
            <StatCard
              label="Failing assertions"
              value={counts?.failing}
              loading={loadingCounts}
              tone={counts && counts.failing > 0 ? "warn" : "ok"}
            />
          </div>
        )}

        {counts && counts.duplicates > 0 && (
          <Link
            to="/reports/duplicate-drafts"
            className="inline-flex text-sm font-medium text-primary underline underline-offset-4"
          >
            Review duplicate drafts before posting
          </Link>
        )}

        {baseAccountId !== null && (
          <button
            onClick={handlePost}
            disabled={!canPost}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {posting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {posting ? "Posting…" : "Post reviewed entries"}
          </button>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-sm text-destructive/80 break-words">
              {error}
            </div>
          </div>
        )}

        {result && !error && (
          <div className="flex items-start gap-3 rounded-md border border-green-500/50 bg-green-500/10 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
            <div className="text-sm">
              Posted {result.drafts_posted} draft
              {result.drafts_posted === 1 ? "" : "s"} under{" "}
              <span className="font-medium">{result.base_account}</span> —{" "}
              {result.journals_created} journal
              {result.journals_created === 1 ? "" : "s"},{" "}
              {result.entries_created} entr
              {result.entries_created === 1 ? "y" : "ies"} created.
            </div>
          </div>
        )}
      </div>
    </AppPage>
  );
}

function StatCard({
  label,
  value,
  loading,
  tone = "neutral",
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "text-destructive"
      : tone === "ok"
        ? "text-green-600"
        : "";
  return (
    <div className="rounded-md border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : value === undefined ? (
          "—"
        ) : (
          value
        )}
      </div>
    </div>
  );
}
