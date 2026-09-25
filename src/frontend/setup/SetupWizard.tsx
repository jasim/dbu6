import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage } from "../api";
import { LoadError } from "../components/load-error";
import { Screen, ScreenTitle } from "../components/screen";
import { setupStatusQuery } from "../queries";
import { SetupRail } from "./SetupRail";
import {
  firstOpenStep,
  railSteps,
  SETUP_STEP_ROUTES,
  type SetupStepId,
} from "./steps";

/*
 * The setup wizard (/setup): the chart of accounts, the banks and cards
 * statements come from, a first statement for each, then Review. Every step
 * reads where it stands from the books, so leaving and coming back shows
 * where things are.
 */

/** `/setup`: the first step the books haven't done, else Review. */
export function SetupIndex() {
  const status = useQuery(setupStatusQuery);
  if (status.isError) {
    return (
      <SetupFrame step="accounts">
        <LoadError
          title="Couldn't load where your setup stands"
          message={apiErrorMessage(status.error)}
          retry={() => void status.refetch()}
        />
      </SetupFrame>
    );
  }
  if (!status.data) return <SetupFrame step="accounts">{null}</SetupFrame>;
  return (
    <Navigate to={SETUP_STEP_ROUTES[firstOpenStep(status.data)]} replace />
  );
}

/** A step's screen: the wizard's title and rail beside its own content. */
export function SetupFrame({
  step,
  children,
}: {
  step: SetupStepId;
  children: ReactNode;
}) {
  usePageTitle("Set up your books");
  const status = useQuery(setupStatusQuery);
  return (
    <Screen width="wide" header={<ScreenTitle title="Set up your books" />}>
      <div className="mt-6 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <SetupRail steps={railSteps(status.data ?? null, step)} />
        <div className="mt-6 min-w-0 md:mt-0">{children}</div>
      </div>
    </Screen>
  );
}

/** A step's heading, a verb phrase, and the one line of why under it. */
export function StepHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-heading text-foreground">{title}</h2>
      <p className="mt-1 text-meta text-ink-meta">{children}</p>
    </div>
  );
}
