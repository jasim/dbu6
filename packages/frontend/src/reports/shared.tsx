import { useEffect, useState, type DependencyList } from "react";
import {
  ReportError,
  ReportGridDataset,
  type ReportCellLinkResolvers,
} from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { Input } from "@sapporta/ui";

export const today = new Date().toISOString().slice(0, 10);

export function useReportResult(
  callReport: () => Promise<GridDataset>,
  dependencies: DependencyList,
  enabled = true,
) {
  const [result, setResult] = useState<GridDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    callReport()
      .then((body) => {
        if (cancelled) return;
        setResult(body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(formatError(err));
        setResult(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, runKey, ...dependencies]);

  return {
    result,
    error,
    loading,
    run: () => setRunKey((value) => value + 1),
  };
}

export function ReportResultBody<TInput = unknown>({
  error,
  linkContext,
  links,
  result,
}: {
  error: string | null;
  linkContext?: { input: TInput };
  links?: ReportCellLinkResolvers<TInput>;
  result: GridDataset | null;
}) {
  return (
    <>
      {error ? <ReportError error={error} /> : null}
      <div className="flex-1 overflow-auto bg-sap-surface">
        {result ? (
          <ReportGridDataset
            dataset={result}
            links={links}
            linkContext={linkContext}
          />
        ) : null}
      </div>
    </>
  );
}

export function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sap-data">
      <span className="text-sap-subtle">{label}:</span>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-sap-ctl w-[140px] rounded-[5px] text-sap-emph mono"
      />
    </label>
  );
}

function formatError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object" && "body" in value) {
    const body = value.body;
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  }
  return String(value);
}
