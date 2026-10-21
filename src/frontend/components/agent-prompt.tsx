import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Copy, SquareTerminal } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { comboboxClassNames } from "@sapporta/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { CODING_AGENTS, type AgentHandoff } from "../../shared/index";
import type { AgentPrompt } from "../agent-prompt-rules";
import { agentHandoffApi, apiRefusalMessage } from "../api";
import { agentHandoffAvailabilityQuery } from "../queries";
import { Button } from "./ui/button";

/**
 * The one control for every prompt the app hands to the user's coding agent.
 * Handing work to the agent is an ordinary action in dbu6, so it is an
 * ordinary button: its label is the task ("Fix the parser"), and a terminal
 * icon is all that says the agent does it. Its arrow holds the rest: where it
 * opens, Copy prompt, and View prompt.
 *
 * Once the agent has the prompt, the button gives way to a line saying so,
 * with a way to open it again, and the command to run, when the terminal
 * didn't open, and `afterwards`: what the user does next.
 *
 * Where the server can't start an agent, the button copies the prompt
 * instead, for whatever agent the user runs in the project.
 *
 * `prompt` comes from agentPrompt (agent-prompt-rules.ts), which carries the
 * plan-first rule, so the agent's first reply is its plan and it does nothing
 * until the user says go. That is said once, in the rule, not beside every
 * button.
 *
 * Which agent is started, and whether the server can open a terminal for it,
 * is the server's to decide: the button only asks, and the result says what
 * happened.
 */
export function AgentButton({
  label,
  prompt,
  afterwards,
  onActed,
  primary = true,
  wide = false,
}: {
  /** What the agent gets done, in a few words: "Fix the parser". */
  label: string;
  prompt: AgentPrompt;
  /** What the user does once the agent has the prompt. */
  afterwards?: ReactNode;
  /**
   * Once the user has taken the prompt: copied it, or the agent opened in a
   * terminal. A command still to run is "command", since the user has it
   * but the agent doesn't yet.
   */
  onActed?: (how: "copied" | "opened" | "command") => void;
  /**
   * The screen's one obvious next step. Where the screen already has one
   * (Check again), the button is an outline beside it.
   */
  primary?: boolean;
  /** The region's last step: the button takes its whole width. */
  wide?: boolean;
}) {
  const availability = useQuery(agentHandoffAvailabilityQuery).data;
  const handsOff = availability !== undefined && availability.mode !== "none";
  const handoff = useMutation({
    mutationFn: (sent: string) =>
      agentHandoffApi.handOffPrompt({ body: { prompt: sent } }),
  });
  const text: string = prompt;
  const [copied, setCopied] = useState<string>();
  // The last result, kept while a retry is out so the line stays put.
  const [result, setResult] = useState<{
    text: string;
    handoff: AgentHandoff;
  }>();
  const [justCopied, setJustCopied] = useState(false);
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    if (!justCopied) return;
    const timer = setTimeout(() => setJustCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [justCopied]);

  // A result, and the advice that follows it, belong to the prompt they were
  // made for; a new prompt leaves both behind.
  const asked = handoff.variables === text;
  const handedOff = result?.text === text ? result.handoff : undefined;
  const acted = copied === text || handedOff !== undefined;
  const agent = handsOff ? CODING_AGENTS[availability.agent].label : "";
  const where =
    handsOff && availability.mode === "terminal"
      ? `Open in ${agent}`
      : `Command for ${agent}`;

  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setJustCopied(true);
      onActed?.("copied");
    });
  };
  const handOff = () =>
    handoff.mutate(text, {
      onSuccess: (handedOver) => {
        setResult({ text, handoff: handedOver });
        onActed?.(handedOver.mode === "terminal" ? "opened" : "command");
      },
    });

  const variant = primary ? "default" : "outline";
  return (
    <div>
      {handedOff ? (
        <HandoffResult
          handoff={handedOff}
          retry={handOff}
          retrying={handoff.isPending}
        />
      ) : (
        <div className={cn("flex", wide ? "w-full" : "inline-flex max-w-full")}>
          <Button
            type="button"
            variant={variant}
            className={cn(
              "h-auto min-h-[calc(var(--height-sap-ctl)+2px)] min-w-0 whitespace-normal rounded-r-none py-1.5 text-left",
              wide && "flex-1 justify-start",
            )}
            disabled={handoff.isPending}
            onClick={handsOff ? handOff : copy}
          >
            {handsOff ? (
              <SquareTerminal aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            <span>{justCopied ? "Copied" : label}</span>
            {/* Said to a screen reader; on screen the icon says it. */}
            <span className="sr-only">
              {handsOff ? `. ${where}` : ". Copies the prompt"}
            </span>
          </Button>
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button
                  type="button"
                  variant={variant}
                  aria-label="More ways to give this to your agent"
                  className={cn(
                    "h-auto rounded-l-none border-l px-2",
                    primary ? "border-l-primary-foreground/30" : "-ml-px",
                  )}
                />
              }
            >
              <ChevronDown aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                className={comboboxClassNames.positioner}
                align="end"
                sideOffset={4}
              >
                <Menu.Popup
                  className={cn(
                    comboboxClassNames.popup,
                    "w-auto min-w-48 p-1",
                  )}
                >
                  {handsOff && (
                    <Menu.Item
                      className={comboboxClassNames.item}
                      onClick={handOff}
                    >
                      {where}
                    </Menu.Item>
                  )}
                  <Menu.Item className={comboboxClassNames.item} onClick={copy}>
                    Copy prompt
                  </Menu.Item>
                  <Menu.Item
                    className={comboboxClassNames.item}
                    onClick={() => setViewing(true)}
                  >
                    View prompt
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      )}
      <div aria-live="polite">
        {asked && handoff.isError && (
          <p className="mt-2 text-body text-destructive [overflow-wrap:anywhere]">
            {apiRefusalMessage(handoff.error)}
          </p>
        )}
        {acted && afterwards !== undefined && (
          <div className="mt-2 text-body text-ink-soft">{afterwards}</div>
        )}
      </div>
      <Dialog open={viewing} onOpenChange={setViewing}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-heading">{label}</DialogTitle>
          </DialogHeader>
          <PromptText prompt={prompt} />
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              <Copy aria-hidden="true" />
              {justCopied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The prompt as the agent gets it. */
function PromptText({ prompt }: { prompt: string }) {
  return (
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-control border border-sap-border bg-sap-nested p-3 font-mono text-meta">
      {prompt}
    </pre>
  );
}

/**
 * Where the prompt went, in place of the button that sent it. Where the
 * terminal didn't open, Try again opens it once more and shows the command
 * beside it, for when that doesn't open either.
 */
function HandoffResult({
  handoff,
  retry,
  retrying,
}: {
  handoff: AgentHandoff;
  retry: () => void;
  retrying: boolean;
}) {
  const label = CODING_AGENTS[handoff.agent].label;
  const [showCommand, setShowCommand] = useState(handoff.mode === "command");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2 rounded-full border border-sap-border bg-card py-1 pl-2.5 pr-3 text-meta text-ink-soft">
          <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-primary"
          />
          {handoff.mode === "terminal"
            ? `Opened in ${label} — continue in your terminal`
            : `Run this to start ${label}. It shows its plan first.`}
        </span>
        {handoff.mode === "terminal" && !showCommand && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-ink-meta"
            disabled={retrying}
            onClick={() => {
              setShowCommand(true);
              retry();
            }}
          >
            Didn't open? Try again
          </Button>
        )}
      </div>
      {showCommand && <Command command={handoff.command} />}
    </div>
  );
}

function Command({ command }: { command: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <code className="min-w-0 flex-1 break-all rounded-control border border-sap-border bg-card px-3 py-2 font-mono text-meta">
        {command}
      </code>
      <CopyButton text={command} label="Copy" />
    </div>
  );
}

/** Copies text, and says so for two seconds. */
export function CopyButton({ text, label }: { text: string; label: string }) {
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
