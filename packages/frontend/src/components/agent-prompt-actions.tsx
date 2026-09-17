import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, SquareTerminal } from "lucide-react";
import {
  CODING_AGENT_LABEL,
  type AgentHandoff,
  type AgentHandoffRequest,
  type CodingAgent,
} from "dbu6-shared";
import { agentHandoffApi, apiErrorMessage } from "../api";
import { agentHandoffCapabilitiesQuery } from "../queries";
import { Disclosure } from "./disclosure";
import { Button } from "./ui/button";

/**
 * Hands a prompt to the user's coding agent wherever the app can't go further
 * on its own (Import, freeform import, Review). Copy prompt always; and for
 * each agent installed on the server's machine, a session started on the
 * prompt: in a new terminal window on macOS, or a command to run in one
 * elsewhere. The session is interactive, so the user answers the agent and
 * approves its edits there.
 */
export function AgentPromptActions({ prompt }: { prompt: string }) {
  const capabilities = useQuery(agentHandoffCapabilitiesQuery).data;
  const handoff = useMutation({
    mutationFn: (request: AgentHandoffRequest) =>
      agentHandoffApi.handOffPrompt({ body: request }),
  });
  // A result belongs to the prompt it was made for.
  const request =
    handoff.variables?.prompt === prompt ? handoff.variables : null;
  const open = capabilities?.open_terminal === true;
  const agents = capabilities?.shell_command ? capabilities.agents : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        <CopyButton text={prompt} label="Copy prompt" />
        {agents.map((agent) => (
          <Button
            key={agent}
            type="button"
            variant="outline"
            size="sm"
            disabled={handoff.isPending}
            onClick={() => handoff.mutate({ agent, prompt, open })}
          >
            <SquareTerminal />
            {open
              ? `Open in ${CODING_AGENT_LABEL[agent]}`
              : `Command for ${CODING_AGENT_LABEL[agent]}`}
          </Button>
        ))}
      </div>
      <div aria-live="polite">
        {request !== null && handoff.isSuccess && (
          <HandoffResult request={request} handoff={handoff.data} />
        )}
        {request !== null && handoff.isError && (
          <p className="text-body text-destructive [overflow-wrap:anywhere]">
            {handoffErrorMessage(handoff.error)}
          </p>
        )}
      </div>
    </div>
  );
}

function HandoffResult({
  request,
  handoff,
}: {
  request: { agent: CodingAgent; open: boolean };
  handoff: AgentHandoff;
}) {
  const label = CODING_AGENT_LABEL[request.agent];
  if (!request.open) {
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

/** The server explains its refusals in `message`. */
function handoffErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "body" in error) {
    const body = error.body;
    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
  }
  return apiErrorMessage(error);
}
