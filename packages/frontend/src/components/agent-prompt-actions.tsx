import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, SquareTerminal } from "lucide-react";
import { CODING_AGENTS, type AgentHandoff } from "dbu6-shared";
import { agentHandoffApi, apiRefusalMessage } from "../api";
import { agentHandoffAvailabilityQuery } from "../queries";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

/**
 * Hands a prompt to the user's coding agent wherever the app can't go further
 * on its own (Import, freeform import, Review). Copy prompt always; and when
 * the server's machine has a coding agent, a session started on the prompt in
 * the agent chosen in Settings: in a new terminal window on macOS, or a
 * command to run in one elsewhere. Which agent, and which of the two, is the
 * server's to decide, so the button only asks and the result says what
 * happened. The session is interactive, so the user answers the agent there;
 * it runs in auto mode, so its edits don't wait on the user's approval.
 */
export function AgentPromptActions({ prompt }: { prompt: string }) {
  const availability = useQuery(agentHandoffAvailabilityQuery).data;
  const handoff = useMutation({
    mutationFn: (text: string) =>
      agentHandoffApi.handOffPrompt({ body: { prompt: text } }),
  });
  // A result belongs to the prompt it was made for.
  const asked = handoff.variables === prompt;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        <CopyButton text={prompt} label="Copy prompt" />
        {availability !== undefined && availability.mode !== "none" && (
          <Button
            type="button"
            variant="outline"
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
      </div>
      <div aria-live="polite">
        {asked && handoff.isSuccess && <HandoffResult handoff={handoff.data} />}
        {asked && handoff.isError && (
          <p className="text-body text-destructive [overflow-wrap:anywhere]">
            {apiRefusalMessage(handoff.error)}
          </p>
        )}
      </div>
    </div>
  );
}

function HandoffResult({ handoff }: { handoff: AgentHandoff }) {
  const label = CODING_AGENTS[handoff.agent].label;
  if (handoff.mode === "command") {
    return (
      <div className="space-y-2">
        <p className="text-body text-ink-soft">
          Run this in a terminal to start {label} on the prompt, then answer it
          there:
        </p>
        <Command command={handoff.command} />
      </div>
    );
  }
  return (
    <div>
      <p className="text-body text-ink-soft">
        {label} opened in a new terminal window. Answer it there.
      </p>
      <Disclosure summary="Didn't open?">
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
      <code className="min-w-0 flex-1 break-all rounded-control bg-muted px-3 py-2 font-mono text-meta">
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
