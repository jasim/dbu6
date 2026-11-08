import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import {
  CODING_AGENTS,
  codingAgentInUse,
  type CodingAgent as Agent,
  type CodingAgentStatus,
} from "../../../shared/index";
import { apiErrorMessage, apiRefusalMessage, codingAgentApi } from "../../api";
import { LoadError } from "../../components/load-error";
import { Screen, ScreenTitle } from "../../components/screen";
import { Button } from "../../components/ui/button";
import { codingAgentSettingsQuery, refreshCodingAgent } from "../../queries";
import {
  agentStatusCell,
  checkingModels,
  describeCodingAgent,
  type StatusCell,
  type CodingAgentState,
} from "./describeCodingAgent";

// A model check takes a few seconds; the screen asks again until it's done.
const CHECKING_POLL_MS = 2000;

/*
 * The coding agent dbu6 uses for everything AI, installed on the server's
 * machine. One table lists every agent dbu6 knows with its state and models,
 * and a radio on each installed one chooses it. Until the user picks one,
 * dbu6 picks the first installed agent that works and saves it as the choice.
 */
export function CodingAgent() {
  usePageTitle("Coding agent");
  const client = useQueryClient();
  const settings = useQuery({
    ...codingAgentSettingsQuery,
    refetchInterval: (query) =>
      query.state.data !== undefined && checkingModels(query.state.data)
        ? CHECKING_POLL_MS
        : false,
  });
  const choose = useMutation({
    mutationFn: (agent: Agent) =>
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

  const data = settings.data;
  // The radio marks the agent in use, never a chosen one that is gone.
  const inUse = data && codingAgentInUse(data.agents, data.chosen).agent;
  return (
    <Screen
      width="narrow"
      header={
        <ScreenTitle title="Coding agent">
          <p>Configure the coding agent that dbu6 uses.</p>
        </ScreenTitle>
      }
    >
      <div className="mt-6 space-y-4">
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
        {data && (
          <>
            <AgentsTable
              agents={data.agents}
              inUse={inUse?.agent ?? null}
              disabled={choose.isPending}
              onChoose={(agent) => choose.mutate(agent)}
            />
            <AgentMessage
              state={describeCodingAgent(data)}
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
      </div>
    </Screen>
  );
}

function AgentsTable({
  agents,
  inUse,
  disabled,
  onChoose,
}: {
  agents: readonly CodingAgentStatus[];
  inUse: Agent | null;
  disabled: boolean;
  onChoose: (agent: Agent) => void;
}) {
  const name = useId();
  return (
    <div className="overflow-x-auto rounded-card border border-sap-border bg-card shadow-card">
      <table className="w-full text-row">
        <thead className="text-left text-meta text-ink-meta">
          <tr>
            <th scope="col" className="w-10 py-2.5 pl-5 pr-1">
              <span className="sr-only">In use</span>
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Agent
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Status
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 font-medium sm:table-cell"
            >
              Sessions
            </th>
            <th
              scope="col"
              className="hidden py-2.5 pl-3 pr-5 font-medium sm:table-cell"
            >
              Categorization
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((status) => {
            const label = CODING_AGENTS[status.agent].label;
            const chosen = status.agent === inUse;
            const canChoose = status.installed && !disabled && !chosen;
            const models =
              status.models.state === "ready" ? status.models : null;
            return (
              <tr
                key={status.agent}
                className={cn(
                  "border-t border-sap-border",
                  chosen && "bg-money-in-bg",
                  canChoose && "cursor-pointer hover:bg-sap-row-hover",
                )}
                onClick={canChoose ? () => onChoose(status.agent) : undefined}
              >
                <td className="py-2.5 pl-5 pr-1 align-middle">
                  {status.installed && (
                    <input
                      type="radio"
                      name={name}
                      aria-label={label}
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={chosen}
                      disabled={disabled}
                      onChange={() => onChoose(status.agent)}
                    />
                  )}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5",
                    chosen && "font-semibold",
                    !status.installed && "text-ink-meta",
                  )}
                >
                  {label}
                </td>
                <td className="px-3 py-2.5">
                  <StatusText cell={agentStatusCell(status)} />
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  {models ? models.session.label : <NoValue />}
                </td>
                <td className="hidden py-2.5 pl-3 pr-5 sm:table-cell">
                  {models ? models.categorization.label : <NoValue />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StatusText({ cell }: { cell: StatusCell }) {
  return (
    <span
      className={cn(
        cell.tone === "ok" && "text-money-in",
        cell.tone === "attention" && "text-attention-ink",
        cell.tone === "quiet" && "text-ink-meta",
        cell.tone === "plain" && "text-foreground",
      )}
    >
      {cell.tone === "ok" && "✓ "}
      {cell.text}
    </span>
  );
}

function NoValue() {
  return <span className="text-ink-meta">—</span>;
}

/*
 * What the table can't say: the one thing to do when the agent in use
 * doesn't work, and the models that didn't answer. "Check again" is the
 * page's action while something needs doing, and a quiet link otherwise.
 */
function AgentMessage({
  state,
  checkAgain,
  checkingAgain,
}: {
  state: CodingAgentState;
  checkAgain: () => void;
  checkingAgain: boolean;
}) {
  const attention = state.tone === "attention";
  return (
    <div className="space-y-2">
      {state.text && (
        <p
          className={cn(
            "text-body",
            attention ? "text-attention-ink" : "text-ink-soft",
          )}
        >
          {state.text}
          {state.command && (
            <>
              {" "}
              <code className="rounded-control bg-muted px-1.5 py-0.5 font-mono text-meta text-foreground">
                {state.command}
              </code>
            </>
          )}
        </p>
      )}
      {state.caption && (
        <p className="text-meta text-ink-meta">{state.caption}</p>
      )}
      {state.details.map((line) => (
        <p
          key={line}
          className="text-meta text-ink-soft [overflow-wrap:anywhere]"
        >
          {line}
        </p>
      ))}
      {state.checkAgain && (
        <Button
          type="button"
          variant={attention ? "attention" : "ghost"}
          size="sm"
          disabled={checkingAgain}
          onClick={checkAgain}
        >
          <RefreshCw />
          Check again
        </Button>
      )}
    </div>
  );
}
