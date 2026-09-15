import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, AlertCircle, CheckCircle2 } from "lucide-react";
import { LookupPicker, useTableLookup } from "@sapporta/frontend/lookup";
import { getApiBase } from "@sapporta/frontend/platform";
import { AppPage } from "@sapporta/frontend/shell";
import { draftTransactionsApi, reportsApi } from "../api";
import { Button } from "../components/ui/button";
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

  // Why posting can't start yet; undefined once every check passes.
  const postWaiting = loadingCounts
    ? "Checking the draft"
    : counts === null
      ? "Could not check the draft"
      : counts.drafts === 0
        ? "No drafts to post"
        : counts.uncategorized > 0
          ? "Categorize every draft first"
          : counts.duplicates > 0
            ? "Resolve the duplicate drafts first"
            : counts.failing > 0
              ? "Fix the failing balance checks first"
              : undefined;

  return (
    <AppPage section="Finish" title="Post reviewed entries">
      <div className="p-8 max-w-4xl space-y-6">
        <p className="text-body text-ink-soft">
          Choose a bank or card account to make its draft part of the books.
          Posting creates the journals and balanced journal entries used by your
          ledgers and reports. The final button stays locked until every draft
          is categorized and the duplicate and balance checks pass.
        </p>

        <div className="space-y-3 rounded-card border bg-card p-4">
          <div className="space-y-1">
            <label
              htmlFor="post-drafts-base-account"
              className="text-row font-medium text-foreground"
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
          <Button
            render={<Link to="/reports/duplicate-drafts" />}
            nativeButton={false}
            variant="ghost"
          >
            Review duplicate drafts before posting
          </Button>
        )}

        {baseAccountId !== null && (
          <Button onClick={handlePost} waiting={postWaiting} disabled={posting}>
            {posting ? <Loader2 className="animate-spin" /> : <Send />}
            {posting ? "Posting…" : "Post reviewed entries"}
          </Button>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}

        {result && !error && (
          <div className="flex items-start gap-3 rounded-card border border-money-in-border bg-money-in-bg p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-money-in mt-0.5" />
            <div className="text-row text-money-in-ink">
              Posted{" "}
              <span className="tnum font-mono">{result.drafts_posted}</span>{" "}
              draft
              {result.drafts_posted === 1 ? "" : "s"} under{" "}
              <span className="font-medium">{result.base_account}</span> —{" "}
              <span className="tnum font-mono">{result.journals_created}</span>{" "}
              journal
              {result.journals_created === 1 ? "" : "s"},{" "}
              <span className="tnum font-mono">{result.entries_created}</span>{" "}
              entr
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
        ? "text-money-in"
        : "text-foreground";
  return (
    <div className="rounded-card border bg-card p-4">
      <div className="text-meta text-ink-meta">{label}</div>
      <div className={`tnum mt-1 font-mono text-heading ${toneClass}`}>
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
