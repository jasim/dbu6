import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  ListChecks,
  RefreshCw,
  Scale,
} from "lucide-react";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { CODING_AGENTS, type CodingAgent } from "../../../shared/index";
import { apiErrorMessage, apiRefusalMessage, codingAgentApi } from "../../api";
import { LinkCard } from "../../components/link-card";
import { LoadError } from "../../components/load-error";
import { Screen } from "../../components/screen";
import { Button } from "../../components/ui/button";
import { IMPORT_INSTRUCTIONS_ROUTE } from "../import-instructions/ImportInstructions";
import { OPENING_BALANCES_ROUTE } from "../opening-balances/OpeningBalances";
import { SETUP_ROUTE } from "../../setup/steps";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { codingAgentSettingsQuery, refreshCodingAgent } from "../../queries";
import {
  checkingModels,
  describeCodingAgent,
  type CodingAgentState,
} from "./describeCodingAgent";

// A model check takes a few seconds; the screen asks again until it's done.
const CHECKING_POLL_MS = 2000;

/*
 * The coding agent dbu6 uses for everything AI, installed on the server's
 * machine, and the models it runs on. Until the user picks one, dbu6 uses the
 * first installed. Below it, the way to setting up accounts, to their opening
 * balances and to their categorization instructions.
 */
export function Settings() {
  usePageTitle("Settings");
  const labelId = useId();
  const client = useQueryClient();
  const settings = useQuery({
    ...codingAgentSettingsQuery,
    refetchInterval: (query) =>
      query.state.data !== undefined && checkingModels(query.state.data)
        ? CHECKING_POLL_MS
        : false,
  });
  const choose = useMutation({
    mutationFn: (agent: CodingAgent) =>
      codingAgentApi.chooseCodingAgent({ body: { agent } }),
    onSuccess: (body) => {
      client.setQueryData(codingAgentSettingsQuery.queryKey, body);
      void refreshCodingAgent(client);
    },
  });
  const checkAgain = useMutation({
    mutationFn: () => codingAgentApi.checkCodingAgentModels({ body: {} }),
    onSuccess: (body) => {
      client.setQueryData(codingAgentSettingsQuery.queryKey, body);
    },
  });

  return (
    <Screen
      width="narrow"
      header={<h1 className="text-title text-foreground">Settings</h1>}
    >
      <section className="mt-5 space-y-3">
        <h2 id={labelId} className="text-heading text-foreground">
          Coding agent
        </h2>
        {settings.isPending && (
          <p className="text-body text-ink-meta">Looking for coding agents…</p>
        )}
        {settings.isError && (
          <LoadError
            title="Couldn't check for coding agents"
            message={apiErrorMessage(settings.error)}
            retry={() => void settings.refetch()}
          />
        )}
        {settings.data && (
          <>
            <RadioGroup<CodingAgent | null>
              aria-labelledby={labelId}
              className="max-w-[480px]"
              value={settings.data.active}
              disabled={choose.isPending}
              onValueChange={(agent) => {
                if (agent !== null) choose.mutate(agent);
              }}
            >
              {settings.data.agents.map(({ agent, installed }) => (
                <RadioGroupItem key={agent} value={agent} disabled={!installed}>
                  {CODING_AGENTS[agent].label}
                  {!installed && " (not installed)"}
                </RadioGroupItem>
              ))}
            </RadioGroup>
            <AgentState
              state={describeCodingAgent(settings.data)}
              checkAgain={() => checkAgain.mutate()}
              checkingAgain={checkAgain.isPending}
            />
            {choose.isError && (
              <p className="text-body text-destructive [overflow-wrap:anywhere]">
                {apiRefusalMessage(choose.error)}
              </p>
            )}
            {checkAgain.isError && (
              <p className="text-body text-destructive [overflow-wrap:anywhere]">
                {apiRefusalMessage(checkAgain.error)}
              </p>
            )}
          </>
        )}
      </section>
      <section className="mt-10 space-y-3">
        <h2 className="text-heading text-foreground">Accounts</h2>
        <div className="max-w-[480px] space-y-2">
          <LinkCard
            label="Set up accounts and statement formats"
            description="Your chart of accounts, banks and cards, and what their statements look like"
            to={SETUP_ROUTE}
            icon={ListChecks}
          />
          <LinkCard
            label="Opening balances"
            description="What each bank, card and loan account started at"
            to={OPENING_BALANCES_ROUTE}
            icon={Scale}
          />
          <LinkCard
            label="Categorization instructions"
            description="What the coding agent reads for each account, file by file"
            to={IMPORT_INSTRUCTIONS_ROUTE}
            icon={FileText}
          />
        </div>
      </section>
    </Screen>
  );
}

function AgentState({
  state,
  checkAgain,
  checkingAgain,
}: {
  state: CodingAgentState;
  checkAgain: () => void;
  checkingAgain: boolean;
}) {
  const ok = state.tone === "ok";
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div className="max-w-[640px] space-y-2">
      <p
        className={cn(
          "flex items-start gap-2 text-body",
          ok ? "text-ink-soft" : "text-attention-ink",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0", ok && "text-money-in")}
        />
        <span>
          {state.text}
          {state.command && (
            <>
              {" "}
              <code className="rounded-control bg-muted px-1.5 py-0.5 font-mono text-meta text-foreground">
                {state.command}
              </code>
            </>
          )}
        </span>
      </p>
      {state.details.map((line) => (
        <p
          key={line}
          className="pl-6 text-meta text-ink-meta [overflow-wrap:anywhere]"
        >
          {line}
        </p>
      ))}
      {state.checkAgain && (
        <div className="pl-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checkingAgain}
            onClick={checkAgain}
          >
            <RefreshCw />
            Check again
          </Button>
        </div>
      )}
    </div>
  );
}
