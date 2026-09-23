import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { buttonVariants } from "../../components/ui/button";
import type { AgentUnavailable } from "./describeCategorization";

/*
 * Said once per run when the coding agent couldn't be used: the entries were
 * saved without a category, and dbu6 won't ask the agent again until its
 * configuration is checked on Settings. The user comes back and runs the
 * categorization again from here.
 */
export function AgentUnavailableDialog({
  problem,
}: {
  problem: AgentUnavailable | null;
}) {
  const [dismissed, setDismissed] = useState<AgentUnavailable["report"] | null>(
    null,
  );
  const open = problem !== null && dismissed !== problem.report;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && problem) setDismissed(problem.report);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{problem?.title}</DialogTitle>
          <DialogDescription>
            The entries were saved without a category. Check the coding agent's
            configuration on Settings, then run the categorization again.
          </DialogDescription>
        </DialogHeader>
        <p className="text-meta text-ink-meta [overflow-wrap:anywhere]">
          {problem?.reason}
        </p>
        <DialogFooter>
          <Link to="/settings" className={buttonVariants()}>
            Open Settings
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
