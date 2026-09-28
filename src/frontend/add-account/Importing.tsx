import type { MutableRefObject } from "react";
import type { LlmStatus } from "../../shared/index";
import { addAccountApi } from "../api";
import { FactTable, type Fact } from "../components/fact-table";
import { FocusCard, type FocusFrame } from "../components/focus-card";
import { LiveImport, type Finale } from "../import-progress/LiveImport";

/**
 * Card 4's add, while it runs: each step as the server reports it, and the
 * add's rows in a live ledger, each account landing as it is answered; the
 * account and statements it writes until the rows are read.
 */
export function Importing({
  frame,
  progressId,
  name,
  facts,
  categorizer,
  finale,
}: {
  frame: FocusFrame;
  progressId: string;
  name: string;
  /** The account and statements, as Confirm had them. */
  facts: readonly Fact[];
  categorizer: LlmStatus;
  /** Set to this card's finale while it shows. */
  finale: MutableRefObject<Finale | null>;
}) {
  return (
    <FocusCard {...frame} title={name === "" ? "Adding" : `Adding ${name}`}>
      <LiveImport
        progressId={progressId}
        readProgress={readAddProgress}
        firstStep="Set up the account"
        categorizer={categorizer}
        finale={finale}
        before={<FactTable rows={facts} />}
      />
    </FocusCard>
  );
}

function readAddProgress(progressId: string) {
  return addAccountApi.addProgress({ params: { progressId }, query: {} });
}
