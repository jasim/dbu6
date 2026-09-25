import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ChartAccount, ChartSuggestion } from "../../shared/index";
import { apiErrorMessage, setupApi } from "../api";
import { Button } from "../components/ui/button";
import { chartSuggesterQuery } from "../queries";

/*
 * "Describe your money": the user's own words go to the coding agent's LLM,
 * which revises the chart on screen to fit them. One call, up to three
 * minutes; nothing is created until the user ticks through the answer and
 * creates it. With no agent ready, the box says why and the chart on screen
 * stays usable.
 */
export function DescribeMoney({
  current,
  onProposal,
}: {
  /** The chart on screen, which the LLM revises rather than starting over. */
  current: () => ChartAccount[];
  onProposal: (suggestion: ChartSuggestion) => void;
}) {
  const id = useId();
  const suggester = useQuery(chartSuggesterQuery);
  const [description, setDescription] = useState("");
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = suggester.data?.ready === true;

  async function suggest() {
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
    <section className="mb-6 rounded-card border border-sap-border bg-card px-4 py-4 shadow-card">
      <label
        htmlFor={id}
        className="block text-row font-semibold text-foreground"
      >
        Tell us how money moves for you, and we'll propose accounts that fit.
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={4000}
        value={description}
        disabled={asking}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Salaried in Bengaluru; rent, two children in school, a car loan, some freelance income, mutual fund SIPs."
        className="mt-2 block w-full resize-y rounded-control border border-sap-border-strong bg-card px-3 py-2 text-body text-foreground outline-none placeholder:text-ink-meta focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="assist"
          disabled={!ready || asking || description.trim() === ""}
          onClick={() => void suggest()}
        >
          {asking && suggester.data
            ? `${suggester.data.name} is proposing accounts…`
            : "Suggest accounts"}
        </Button>
        <p className="min-w-0 flex-1 basis-[240px] text-meta text-ink-meta">
          {suggester.isPending
            ? "Checking which coding agent can answer…"
            : suggester.data?.ready
              ? asking
                ? "This can take a minute or two."
                : `${suggester.data.name} proposes the accounts on your own plan. Nothing is created until you choose.`
              : null}
        </p>
      </div>
      {suggester.data && !suggester.data.ready && (
        <p className="mt-3 text-body text-ink-soft">
          {suggester.data.reason}{" "}
          <Link
            to="/settings"
            className="text-primary underline-offset-4 hover:underline"
          >
            Open Settings
          </Link>
          . The accounts below can still be created as they are.
        </p>
      )}
      {suggester.isError && (
        <p className="mt-3 text-body text-ink-soft">
          Couldn't check for a coding agent: {apiErrorMessage(suggester.error)}
        </p>
      )}
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
