import { useState } from "react";
import { AgentPrompt } from "../components/agent-prompt";
import { createReportPrompt } from "./createReportPrompt";

/**
 * Create a report: the user says what they want to see, and the panel hands
 * their coding agent a prompt to write it into the project's reports/.
 */
export function CreateReport({ takenIds }: { takenIds: readonly string[] }) {
  const [wanted, setWanted] = useState("");
  return (
    <div className="mt-6 max-w-[760px] space-y-4">
      <label className="block space-y-2">
        <span className="text-row text-foreground">
          What should the report show?
        </span>
        <textarea
          value={wanted}
          onChange={(event) => setWanted(event.target.value)}
          rows={3}
          placeholder="Spending by day of the week, for a period I choose"
          className="block w-full rounded-control border border-sap-border bg-card px-3 py-2 text-row text-foreground placeholder:text-ink-meta"
        />
      </label>
      {wanted.trim() === "" ? (
        <p className="text-meta text-ink-meta">
          Describe the report to see the prompt for your coding agent.
        </p>
      ) : (
        <AgentPrompt
          title="Build this report in your project"
          prompt={createReportPrompt(wanted, takenIds)}
          afterwards="The agent writes it in your project's reports/ folder. Restart dbu6 when it is done, and the report is here under Your reports."
        />
      )}
    </div>
  );
}
