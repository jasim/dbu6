import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { CODING_AGENT_LABEL, type CodingAgent } from "dbu6-shared";
import { apiErrorMessage, apiRefusalMessage, codingAgentApi } from "../../api";
import { LoadError } from "../../components/load-error";
import { Screen } from "../../components/screen";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { codingAgentSettingsQuery, refreshCodingAgent } from "../../queries";
import {
  describeCodingAgent,
  type CodingAgentState,
} from "./describeCodingAgent";

/*
 * The coding agent dbu6 uses for everything AI, installed on the server's
 * machine. Until the user picks one, dbu6 uses the first installed.
 */
export function Settings() {
  usePageTitle("Settings");
  const labelId = useId();
  const client = useQueryClient();
  const settings = useQuery(codingAgentSettingsQuery);
  const choose = useMutation({
    mutationFn: (agent: CodingAgent) =>
      codingAgentApi.chooseCodingAgent({ body: { agent } }),
    onSuccess: (body) => {
      client.setQueryData(codingAgentSettingsQuery.queryKey, body);
      void refreshCodingAgent(client);
    },
  });

  return (
    <Screen
      width="narrow"
      header={<h1 className="text-title text-foreground">Settings</h1>}
    >
      <section className="mt-8 space-y-3">
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
                  {CODING_AGENT_LABEL[agent]}
                  {!installed && " (not installed)"}
                </RadioGroupItem>
              ))}
            </RadioGroup>
            <AgentState state={describeCodingAgent(settings.data)} />
            {choose.isError && (
              <p className="text-body text-destructive [overflow-wrap:anywhere]">
                {apiRefusalMessage(choose.error)}
              </p>
            )}
          </>
        )}
      </section>
    </Screen>
  );
}

function AgentState({ state }: { state: CodingAgentState }) {
  const ok = state.tone === "ok";
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <p
      className={cn(
        "flex max-w-[640px] items-start gap-2 text-body",
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
  );
}
