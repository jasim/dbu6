import { useState } from "react";
import type { ChartAccount, ChartSuggestion } from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { Button } from "../components/ui/button";

/*
 * "Describe your money": the user's own words go to the coding agent's LLM,
 * which revises the chart on screen to fit them. One call, up to three
 * minutes; nothing is created until the user ticks through the answer and
 * creates it. Shown only when an agent is ready (ChartStep checks).
 */
export function DescribeMoney({
  agent,
  current,
  onProposal,
  onBack,
}: {
  /** The ready coding agent's name. */
  agent: string;
  /** The chart on screen, which the LLM revises rather than starting over. */
  current: () => ChartAccount[];
  onProposal: (suggestion: ChartSuggestion) => void;
  onBack: () => void;
}) {
  const [description, setDescription] = useState("");
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function propose() {
    setAsking(true);
    setProblem(null);
    try {
      onProposal(
        await setupApi.suggestChartOfAccounts({
          body: { description, current: current() },
        }),
      );
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="mb-5 rounded-card border border-sap-border bg-card px-4 py-4 shadow-card">
      <textarea
        aria-label="Describe your money"
        rows={3}
        maxLength={4000}
        value={description}
        disabled={asking}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Salaried in Bengaluru; rent, two children in school, a car loan, some freelance income, mutual fund SIPs."
        className="block w-full resize-y rounded-control border border-sap-border-strong bg-card px-3 py-2 text-body text-foreground outline-none placeholder:text-ink-meta focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />
      <p className="mt-2 text-meta text-ink-meta">
        ✦ {agent} proposes accounts that fit. Nothing is created until you do.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button
          variant="assist"
          disabled={asking || description.trim() === ""}
          onClick={() => void propose()}
        >
          {asking ? `${agent} is thinking…` : "Propose accounts"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back to the standard chart
        </Button>
      </div>
      {problem && (
        <p
          role="alert"
          className="mt-3 text-body text-destructive [overflow-wrap:anywhere]"
        >
          {problem}
        </p>
      )}
    </section>
  );
}
