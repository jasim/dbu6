import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import { apiErrorMessage } from "../api";
import { LoadError } from "../components/load-error";
import { ProgressSteps } from "../components/progress-steps";
import { Screen, ScreenTitle } from "../components/screen";
import { setupStatusQuery } from "../queries";
import {
  firstOpenStep,
  setupSteps,
  SETUP_STEP_ROUTES,
  type SetupStepId,
} from "./steps";

/*
 * The account setup wizard (/setup): the chart of accounts, the banks and
 * cards statements come from, and a sample statement for each, then the
 * opening balances screen. Every step reads where it stands from the books,
 * so leaving and coming back shows where things are.
 */

/** `/setup`: the first step the books haven't done. */
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

/** A step's screen: the wizard's title and steps above its own content. */
export function SetupFrame({
  step,
  children,
}: {
  step: SetupStepId;
  children: ReactNode;
}) {
  usePageTitle("Set up your accounts");
  const status = useQuery(setupStatusQuery);
  return (
    <Screen
      width="wide"
      header={
        <ScreenTitle title="Set up your accounts">
          <p>
            The accounts your books sort money into, the banks and cards you get
            statements from, and what each statement looks like. Come back any
            time from Settings.
          </p>
        </ScreenTitle>
      }
    >
      <nav className="mt-6" aria-label="Setup steps">
        <ProgressSteps
          label="Setup steps"
          steps={setupSteps(status.data ?? null, step)}
        />
      </nav>
      <div className="mt-8">{children}</div>
    </Screen>
  );
}

/** A step's heading and the sentence or two under it. */
export function StepHeading({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-heading text-foreground">{title}</h2>
      <p className="mt-1 max-w-[700px] text-body text-ink-soft">{children}</p>
    </div>
  );
}
