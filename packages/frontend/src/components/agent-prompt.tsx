import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Sparkles, SquareTerminal } from "lucide-react";
import { CODING_AGENTS, type AgentHandoff } from "dbu6-shared";
import { agentHandoffApi, apiRefusalMessage } from "../api";
import { agentHandoffAvailabilityQuery } from "../queries";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

/**
 * The one panel for every prompt the app hands to the user's coding agent
 * (Import, freeform import, Review). It is violet, and nothing else in the
 * app is, so an AI-assisted prompt is recognisable before it is read.
 *
 * It gives the user as little to read as it can: the `title`, and buttons
 * that say what they do. `afterwards` is for once the agent has the prompt,
 * so it waits until the user has taken it somewhere.
 *
 * Which agent is started, and whether the server can open a terminal for it,
 * is the server's to decide: the button only asks, and the result says what
 * happened. The session is interactive, so the user carries the conversation
 * on there; it runs in auto mode, so its edits don't wait on approval.
 */
export function AgentPrompt({
  title,
  prompt,
  afterwards,
}: {
  /** What this prompt gets done, in one short line. */
  title: string;
  prompt: string;
  /** What the user does once the agent has the prompt. */
  afterwards?: ReactNode;
}) {
  const availability = useQuery(agentHandoffAvailabilityQuery).data;
  // The button shows only where the server can start an agent; copying is
  // offered everywhere, and on its own is the whole of the panel's advice.
  const handsOff = availability !== undefined && availability.mode !== "none";
  const handoff = useMutation({
    mutationFn: (text: string) =>
      agentHandoffApi.handOffPrompt({ body: { prompt: text } }),
  });
  const [copied, setCopied] = useState<string>();
  // A result, and the advice that follows it, belong to the prompt they were
  // made for; a new prompt leaves both behind.
  const asked = handoff.variables === prompt;
  const acted = copied === prompt || (asked && handoff.isSuccess);

  return (
    <section className="rounded-card border border-assist-border bg-assist-bg px-5 py-[18px] sm:px-6">
      <p className="flex items-center gap-1.5 text-label uppercase text-assist-ink">
        <Sparkles aria-hidden="true" className="size-[15px]" />
        AI assisted
      </p>
      <h3 className="mt-1.5 text-subheading text-foreground [overflow-wrap:anywhere]">
        {title}
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {handsOff && (
          <Button
            type="button"
            variant="assist"
            size="sm"
            disabled={handoff.isPending}
            onClick={() => handoff.mutate(prompt)}
          >
            <SquareTerminal />
            {availability.mode === "terminal"
              ? `Open in ${CODING_AGENTS[availability.agent].label}`
              : `Command for ${CODING_AGENTS[availability.agent].label}`}
          </Button>
        )}
        <CopyButton text={prompt} label="Copy prompt" onCopied={setCopied} />
      </div>
      {!handsOff && (
        <p className="mt-2 text-meta text-ink-meta">
          Run your agent in this app's repo.
        </p>
      )}
      <div aria-live="polite">
        {asked && handoff.isSuccess && <HandoffResult handoff={handoff.data} />}
        {asked && handoff.isError && (
          <p className="mt-3 text-body text-destructive [overflow-wrap:anywhere]">
            {apiRefusalMessage(handoff.error)}
          </p>
        )}
        {acted && afterwards !== undefined && (
          <div className="mt-3 text-body text-ink-soft">{afterwards}</div>
        )}
      </div>
      <div className="mt-2">
        <Disclosure tone="assist" summary="Preview the prompt">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-control border border-assist-border bg-card p-3 font-mono text-meta">
            {prompt}
          </pre>
        </Disclosure>
      </div>
    </section>
  );
}

function HandoffResult({ handoff }: { handoff: AgentHandoff }) {
  const label = CODING_AGENTS[handoff.agent].label;
  if (handoff.mode === "command") {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-body text-ink-soft">
          Run this to start {label}, then continue there:
        </p>
        <Command command={handoff.command} />
      </div>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-body text-ink-soft">
        {label} is open in a terminal. Continue there.
      </p>
      <Disclosure tone="assist" summary="Didn't open?">
        <p className="text-body text-ink-soft">Run this instead:</p>
        <Command command={handoff.command} />
      </Disclosure>
    </div>
  );
}

function Command({ command }: { command: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <code className="min-w-0 flex-1 break-all rounded-control border border-assist-border bg-card px-3 py-2 font-mono text-meta">
        {command}
      </code>
      <CopyButton text={command} label="Copy" />
    </div>
  );
}

/** Copies text, says so for two seconds, and tells the panel what it copied. */
function CopyButton({
  text,
  label,
  onCopied,
}: {
  text: string;
  label: string;
  onCopied?: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          onCopied?.(text);
        });
      }}
    >
      <Copy />
      {copied ? "Copied" : label}
    </Button>
  );
}
