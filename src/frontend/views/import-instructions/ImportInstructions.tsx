import { useId, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { ReviewAccount } from "../../../shared/index";
import { apiErrorMessage } from "../../api";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import {
  importPresetsQuery,
  reviewAccountsQuery,
  transactionMappingsQuery,
} from "../../queries";
import {
  IMPROVE_CATEGORIZATION_TAB,
  REVIEW_ROUTE,
  reviewHref,
} from "../../review/routes";
import {
  presetAccounts,
  presetNames,
} from "../categorization/CategorizationInstructions";
import { AiNotesPanel } from "./AiNotesPanel";
import type { ReadMappings } from "./mapping-rules";
import { RulesPanel } from "./RulePanels";
import { type TabItem, TabList } from "./rule-parts";
import { categorizationRulesHref, readRulesView, type RuleTab } from "./routes";

const PAGE_TITLE = "Automatic transaction categorization rules";

/*
 * Automatic transaction categorization rules: what decides a statement's
 * transactions' accounts on import, one tab per step in the order a
 * transaction meets them. Exact and Contains are the rules in
 * transaction_mappings.mjs, which apply to every account; AI is each bank
 * or card's notes, for whatever the rules miss. Each tab opens on one of
 * the user's own rules as an example. Read-only: the files are edited in
 * user-config/.
 */
export function ImportInstructions() {
  usePageTitle(PAGE_TITLE);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const view = readRulesView(params);
  const mappings = useQuery(transactionMappingsQuery);
  const presets = useQuery(importPresetsQuery);
  const review = useQuery(reviewAccountsQuery);

  const accounts = useMemo(
    () => (presets.data ? presetAccounts(presets.data) : []),
    [presets.data],
  );
  const names = useMemo(() => presetNames(accounts), [accounts]);
  const chosen =
    accounts.find((one) => one.account.account_id === view.accountId) ??
    accounts[0] ??
    null;
  const teach = teachHref(review.data, chosen?.account.account_id ?? null);
  const show = (tab: RuleTab, accountId = view.accountId) =>
    navigate(categorizationRulesHref(tab, accountId), { replace: true });

  const rules: ReadMappings | null =
    mappings.data?.state === "read" ? mappings.data : null;
  const tabs: TabItem<RuleTab>[] = [
    { id: "exact", label: "Exact", count: rules?.exact.length },
    { id: "contains", label: "Contains", count: rules?.includes.length },
    { id: "ai", label: "AI" },
  ];
  const baseId = useId();
  const tabId = (tab: RuleTab) => `${baseId}-${tab}`;
  const panelId = `${baseId}-panel`;

  return (
    <Screen
      width="wide"
      header={
        <ScreenTitle title={PAGE_TITLE}>
          <p>
            When you import a bank or card statement, these decide which account
            each transaction goes to.
          </p>
        </ScreenTitle>
      }
    >
      <div className="mt-7">
        <TabList
          primary
          label="Categorization rules, in the order they apply"
          tabs={tabs}
          selected={view.tab}
          onSelect={(tab) => show(tab)}
          tabId={tabId}
          panelId={panelId}
        />
        <section
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabId(view.tab)}
          className="min-w-0 pt-5"
        >
          {view.tab !== "ai" ? (
            // Each tab's search starts empty.
            <RulesPanel key={view.tab} tab={view.tab} teachHref={teach} />
          ) : presets.isError ? (
            <LoadError
              title="Couldn't load your banks and cards"
              message={apiErrorMessage(presets.error)}
              retry={() => void presets.refetch()}
            />
          ) : presets.isPending ? (
            <p className="text-meta text-ink-meta">Loading…</p>
          ) : (
            <AiNotesPanel
              accounts={accounts}
              names={names}
              chosen={chosen}
              onChoose={(accountId) => show("ai", accountId)}
              teachHref={teach}
            />
          )}
        </section>
      </div>
    </Screen>
  );
}

/**
 * Where to teach the categorizer from drafts: the Improve categorization
 * tab of the account on show, or of the one account with drafts, else the
 * list of accounts to review. None when no account has drafts.
 */
function teachHref(
  withDrafts: readonly ReviewAccount[] | undefined,
  preferred: number | null,
): string | null {
  if (withDrafts === undefined || withDrafts.length === 0) return null;
  const account =
    withDrafts.find((one) => one.account_id === preferred) ??
    (withDrafts.length === 1 ? withDrafts[0] : undefined);
  return account
    ? reviewHref(account.account_id, IMPROVE_CATEGORIZATION_TAB)
    : REVIEW_ROUTE;
}
