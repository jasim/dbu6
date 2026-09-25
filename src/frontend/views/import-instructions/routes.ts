/** Where the categoriser's rules and each account's AI notes are read. */
export const CATEGORIZATION_RULES_ROUTE = "/categorization-rules";

/** The page's tabs, in the order a transaction meets them. */
export const RULE_TABS = ["exact", "contains", "ai"] as const;

export type RuleTab = (typeof RULE_TABS)[number];

/** What the page shows: a tab, and on AI, whose notes (null for the first). */
export interface RulesView {
  tab: RuleTab;
  accountId: number | null;
}

/**
 * The view a URL names: `?show=<tab>`, with `&account=<id>` for AI. Older
 * links still land: `?show=mappings` was the rules, now Exact, and
 * `?account=<id>` alone was that account's guidance, now its AI notes.
 */
export function readRulesView(params: URLSearchParams): RulesView {
  const show = params.get("show");
  const account = params.get("account");
  const accountId =
    account !== null && /^[1-9]\d*$/.test(account) ? Number(account) : null;
  const tab =
    RULE_TABS.find((one) => one === show) ??
    (show === null && accountId !== null ? "ai" : "exact");
  return { tab, accountId };
}

export function categorizationRulesHref(
  tab: RuleTab,
  accountId: number | null = null,
): string {
  const params = new URLSearchParams({ show: tab });
  if (accountId !== null) params.set("account", String(accountId));
  return `${CATEGORIZATION_RULES_ROUTE}?${params}`;
}
