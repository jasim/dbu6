import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { formatMonth } from "../format";
import { today } from "../reports/shared";
import { Choice, FocusCard, type FocusFrame } from "../components/focus-card";
import { defaultMonth, monthChoices, type AddUrl, type From } from "./state";
import { downloadLine, howFarBackTitle } from "./words";

/**
 * Card 2: how far back to import. It changes wording and one conditional
 * card, never what gets imported: the dropped files decide where the account
 * starts. `initial` is the answer carried from the account before.
 */
export function HowFarBack({
  frame,
  url,
  initial,
  onAnswer,
}: {
  frame: FocusFrame;
  url: AddUrl;
  initial: From | null;
  onAnswer: (from: From) => void;
}) {
  const name = useId();
  const now = today();
  const months = monthChoices(now);
  const [kind, setKind] = useState<From["kind"] | null>(initial?.kind ?? null);
  const [month, setMonth] = useState(
    initial?.kind === "month" && months.includes(initial.month)
      ? initial.month
      : defaultMonth(now),
  );
  const answer: From | null =
    kind === null
      ? null
      : kind === "latest"
        ? { kind: "latest" }
        : { kind: "month", month };

  return (
    <FocusCard
      {...frame}
      title={howFarBackTitle(url)}
      actions={
        <Button
          disabled={answer === null}
          onClick={() => answer && onAnswer(answer)}
        >
          Continue
        </Button>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{howFarBackTitle(url)}</legend>
        <Choice
          name={name}
          checked={kind === "latest"}
          onCheck={() => setKind("latest")}
        >
          Just my latest statement
        </Choice>
        <Choice
          name={name}
          checked={kind === "month"}
          onCheck={() => setKind("month")}
        >
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            From
            <select
              aria-label="From month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setKind("month");
              }}
              onClick={(event) => event.stopPropagation()}
              className="h-sap-ctl rounded-control border border-sap-border-strong bg-card px-2.5 text-row text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              {months.map((one) => (
                <option key={one} value={one}>
                  {formatMonth(one)}
                </option>
              ))}
            </select>
          </span>
        </Choice>
      </fieldset>
      {answer && (
        <p role="status" className="mt-4 text-body text-ink-soft">
          {downloadLine(answer)}
        </p>
      )}
    </FocusCard>
  );
}
