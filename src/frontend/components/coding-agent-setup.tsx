import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppWindow, Copy, SquareTerminal, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { CODING_AGENTS, type CodingAgentSetupGuide } from "../../shared/index";
import { apiErrorMessage, codingAgentApi } from "../api";
import { copyText } from "../clipboard";
import {
  codingAgentSettingsQuery,
  codingAgentSetupGuideQuery,
  refreshCodingAgent,
} from "../queries";
import { Button } from "./ui/button";

/*
 * dbu6 is run by a coding agent, so having none is said up front, not as a
 * footnote: a notice saying so and what dbu6 uses one for, and a dialog with
 * Nuabase's own guide to installing one. Nuabase runs the agent's CLI, so it
 * knows which agents it can run and that a desktop app won't do.
 */

/**
 * The notice on a screen whose AI half needs an agent: Nuabase's line that
 * none is set up, what dbu6 does with one, and the way to the guide.
 * `without` says what the screen still offers without one.
 */
export function NoCodingAgentNotice({ without }: { without: string }) {
  const guide = useQuery(codingAgentSetupGuideQuery);
  const [open, setOpen] = useState(false);
  return (
    <div
      role="status"
      className="flex gap-3 rounded-card border border-attention-border bg-attention-bg px-4 py-3 text-attention-ink"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">
          {guide.data?.missing ?? "No coding agent is set up."}
        </p>
        <p className="mt-1 text-body">
          dbu6 uses a coding agent, such as Claude Code or Codex, to tailor your
          accounts, categorize your transactions and read new statement formats.{" "}
          {without}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setOpen(true)}
        >
          How to set one up
        </Button>
      </div>
      <CodingAgentSetupDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** Nuabase's guide to installing a coding agent, and Check again. */
export function CodingAgentSetupDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const guide = useQuery({ ...codingAgentSetupGuideQuery, enabled: open });
  const checkAgain = useMutation({
    mutationFn: () => codingAgentApi.checkCodingAgentModels({ body: {} }),
    onSuccess: (body) => {
      client.setQueryData(codingAgentSettingsQuery.queryKey, body);
      void refreshCodingAgent(client);
    },
  });
  // The agent the last check settled on; null until one works.
  const found = checkAgain.isPending ? null : (checkAgain.data?.chosen ?? null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[88vh] max-w-4xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Set up a coding agent</DialogTitle>
        </DialogHeader>
        {guide.isError && (
          <p role="alert" className="text-body text-destructive">
            Couldn't load the guide: {apiErrorMessage(guide.error)}
          </p>
        )}
        {guide.data && <Guide guide={guide.data} />}
        {checkAgain.isError && (
          <p role="alert" className="text-body text-destructive">
            {apiErrorMessage(checkAgain.error)}
          </p>
        )}
        {checkAgain.data && !checkAgain.isPending && found === null && (
          <p role="status" className="text-body text-ink-soft">
            dbu6 still found no working coding agent. Check that the agent's
            command runs in a terminal and that you signed in to it.
          </p>
        )}
        <DialogFooter className="items-center">
          {found !== null ? (
            <>
              <p role="status" className="mr-auto text-body text-ink-soft">
                dbu6 will use {CODING_AGENTS[found].label}.
              </p>
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => checkAgain.mutate()}
              disabled={checkAgain.isPending}
            >
              {checkAgain.isPending ? "Checking…" : "Check again"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The prompt for a desktop agent comes first: most people who have no CLI
// have the Claude or ChatGPT app. The table is for installing one by hand.
function Guide({ guide }: { guide: CodingAgentSetupGuide }) {
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-card border-2 border-primary px-4 py-4">
        <AppWindow
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-row font-semibold text-foreground">
            Use the Claude or ChatGPT app? Let it do the setup
          </h3>
          <p className="mt-1 text-body text-ink-soft">
            Paste this prompt into your desktop or GUI coding agent. It installs
            a CLI dbu6 can run and walks you through signing in.
          </p>
        </div>
        <CopyButton text={guide.setupPrompt} label="Copy prompt" prominent />
      </section>
      <section>
        <h3 className="flex items-center gap-2 text-label uppercase text-ink-meta">
          <SquareTerminal aria-hidden="true" className="size-4" />
          Or install one yourself, in a terminal
        </h3>
        <table className="mt-2 w-full table-fixed text-body">
          <colgroup>
            <col className="w-[24%]" />
            <col />
            <col className="w-[24%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-label uppercase text-ink-meta">
              <th className="py-1.5 pr-3 font-normal">Agent</th>
              <th className="py-1.5 pr-3 font-normal">Install</th>
              <th className="py-1.5 font-normal">Sign in</th>
            </tr>
          </thead>
          <tbody>
            {guide.agents.map((setup) => (
              <tr key={setup.agent} className="border-t border-sap-border">
                <td className="py-2 pr-3 align-middle">
                  <a
                    href={setup.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-foreground underline underline-offset-4"
                  >
                    {setup.name}
                  </a>
                  <p className="text-meta text-ink-meta">{setup.worksWith}</p>
                </td>
                <td className="py-2 pr-3 align-middle">
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 rounded-control bg-muted px-2 py-1 font-mono text-meta [overflow-wrap:anywhere]">
                      {setup.install}
                    </code>
                    <CopyButton text={setup.install} />
                  </div>
                </td>
                <td className="py-2 align-middle text-ink-soft">
                  <WithCode text={setup.signIn} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-meta text-ink-meta">{guide.cliOnly}</p>
      </section>
    </div>
  );
}

function CopyButton({
  text,
  label = "Copy",
  prominent = false,
}: {
  text: string;
  label?: string;
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={prominent ? "default" : "outline"}
      size={prominent ? "default" : "sm"}
      onClick={() => void copyText(text).then(setCopied)}
    >
      {prominent && <Copy aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// "Run `codex login` in a terminal." with the command set as code.
function WithCode({ text }: { text: string }) {
  return text
    .split("`")
    .map((part, i) => (
      <Fragment key={i}>
        {i % 2 === 1 ? (
          <code className="rounded-control bg-muted px-1 font-mono text-meta text-foreground">
            {part}
          </code>
        ) : (
          part
        )}
      </Fragment>
    ));
}
