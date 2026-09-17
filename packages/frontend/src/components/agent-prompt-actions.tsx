import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, SquareTerminal } from "lucide-react";
import {
  CODING_AGENT_LABEL,
  type AgentHandoff,
  type AgentHandoffRequest,
  type CodingAgent,
} from "dbu6-shared";
import { agentHandoffApi, apiRefusalMessage } from "../api";
import { agentHandoffCapabilitiesQuery } from "../queries";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

/**
 * Hands a prompt to the user's coding agent wherever the app can't go further
 * on its own (Import, freeform import, Review). Copy prompt always; and when
 * the server's machine has a coding agent, a session started on the prompt in
 * the agent chosen in Settings: in a new terminal window on macOS, or a
 * command to run in one elsewhere. The session is interactive, so the user
 * answers the agent there; it runs in auto mode, so its edits don't wait on
 * the user's approval.
 */
export function AgentPromptActions({ prompt }: { prompt: string }) {
  const capabilities = useQuery(agentHandoffCapabilitiesQuery).data;
  const handoff = useMutation({
    mutationFn: ({ request }: HandoffClick) =>
      agentHandoffApi.handOffPrompt({ body: request }),
  });
  // A result belongs to the prompt it was made for.
  const click =
    handoff.variables?.request.prompt === prompt ? handoff.variables : null;
  const open = capabilities?.open_terminal === true;
  const agent = capabilities?.shell_command ? capabilities.agent : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        <CopyButton text={prompt} label="Copy prompt" />
        {agent !== null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={handoff.isPending}
            onClick={() => handoff.mutate({ agent, request: { prompt, open } })}
          >
            <SquareTerminal />
            {open
              ? `Open in ${CODING_AGENT_LABEL[agent]}`
              : `Command for ${CODING_AGENT_LABEL[agent]}`}
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {click !== null && handoff.isSuccess && (
          <HandoffResult click={click} handoff={handoff.data} />
        )}
        {click !== null && handoff.isError && (
          <p className="text-body text-destructive [overflow-wrap:anywhere]">
            {apiRefusalMessage(handoff.error)}
          </p>
        )}
      </div>
    </div>
  );
}

// The agent is the one the button named.
interface HandoffClick {
  agent: CodingAgent;
  request: AgentHandoffRequest;
}

function HandoffResult({
  click,
  handoff,
}: {
  click: HandoffClick;
  handoff: AgentHandoff;
}) {
  const label = CODING_AGENT_LABEL[click.agent];
  if (!click.request.open) {
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
