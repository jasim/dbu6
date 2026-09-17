import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Sparkles, SquareTerminal } from "lucide-react";
import {
  CODING_AGENTS,
  type AgentHandoff,
  type AgentHandoffAvailability,
} from "dbu6-shared";
import { agentHandoffApi, apiRefusalMessage } from "../api";
import { agentHandoffAvailabilityQuery } from "../queries";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

/**
 * The one panel for every prompt the app hands to the user's coding agent
 * (Import, freeform import, Review). It is violet, and nothing else in the
 * app is, so an AI-assisted prompt is recognisable before it is read. Two
 * things carry: `title`, the one thing this prompt gets done, and the line
 * under it, which says the button opens the agent in a terminal.
 *
 * Copying the prompt always works, so a user with no agent on the server's
 * machine, or one who keeps a session of their own open, loses nothing.
 *
 * Which agent is started, and whether the server can open a terminal for it,
 * is the server's to decide: the button only asks, and the result says what
 * happened. The session is interactive, so the user answers the agent there;
 * it runs in auto mode, so its edits don't wait on the user's approval.
 */
export function AgentPrompt({
  title,
  prompt,
  children,
}: {
  /** What this prompt gets done, in one short line. */
  title: string;
  prompt: string;
  /** Anything else the user has to know before starting the agent. */
  children?: ReactNode;
}) {
  const availability = useQuery(agentHandoffAvailabilityQuery).data;
  // The button shows only where the server can start an agent; copying is
  // offered everywhere, and on its own is the whole of the panel's advice.
  const handsOff = availability !== undefined && availability.mode !== "none";
  const handoff = useMutation({
    mutationFn: (text: string) =>
      agentHandoffApi.handOffPrompt({ body: { prompt: text } }),
  });
  // A result belongs to the prompt it was made for.
  const asked = handoff.variables === prompt;

  return (
    <section className="rounded-card border border-assist-border bg-assist-bg px-5 py-[18px] sm:px-6">
      <p className="flex items-center gap-1.5 text-label uppercase text-assist-ink">
        <Sparkles aria-hidden="true" className="size-[15px]" />
        AI assisted
      </p>
      <h3 className="mt-1.5 text-subheading text-foreground [overflow-wrap:anywhere]">
        {title}
      </h3>
      <p className="mt-1 text-body text-ink-soft">
        {whatHappens(availability)}
      </p>
      {children && (
        <div className="mt-1 text-body text-ink-soft">{children}</div>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
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
        <CopyButton text={prompt} label="Copy prompt" />
      </div>
      {handsOff && (
        <p className="mt-2 text-meta text-ink-meta">
          Or copy it and paste it into an agent of your own.
        </p>
      )}
      <div aria-live="polite">
        {asked && handoff.isSuccess && <HandoffResult handoff={handoff.data} />}
        {asked && handoff.isError && (
          <p className="mt-3 text-body text-destructive [overflow-wrap:anywhere]">
            {apiRefusalMessage(handoff.error)}
          </p>
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

/**
 * What the button does, in the terms of the machine running the server: a
 * window it opens, or a command it writes. With no agent there — a deployed
 * instance, or Windows — there is no button, and copying is the whole story.
 */
function whatHappens(
  availability: AgentHandoffAvailability | undefined,
): string {
  if (availability === undefined || availability.mode === "none") {
    return "Copy this prompt into your coding agent, running in this app's repository. It carries everything the agent needs.";
  }
  const label = CODING_AGENTS[availability.agent].label;
  return availability.mode === "terminal"
    ? `Opens ${label} in a new terminal window, on this prompt. You answer it there.`
    : `Starts ${label} on this prompt and gives you the command to run in a terminal. You answer it there.`;
}

function HandoffResult({ handoff }: { handoff: AgentHandoff }) {
  const label = CODING_AGENTS[handoff.agent].label;
  if (handoff.mode === "command") {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-body text-ink-soft">
          Run this in a terminal to start {label} on the prompt, then answer it
          there:
        </p>
        <Command command={handoff.command} />
      </div>
    );
  }
  return (
    <div className="mt-3">
      <p className="text-body text-ink-soft">
        {label} opened in a new terminal window. Answer it there.
      </p>
      <Disclosure tone="assist" summary="Didn't open?">
        <p className="text-body text-ink-soft">
          Run this in a terminal instead:
        </p>
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

/** Copies text, and says so for two seconds. */
function CopyButton({ text, label }: { text: string; label: string }) {
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
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      <Copy />
      {copied ? "Copied" : label}
    </Button>
  );
}
