import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { AppPage } from "@sapporta/frontend/shell";
import type { HledgerExportFile } from "../../shared/index";
import { hledgerExportApi } from "../api";
import { Button } from "../components/ui/button";
import { FactTable } from "../components/fact-table";
import { formatDate } from "../format";
import { today } from "../reports/shared";
import { downloadBlob, zip } from "../zip";

const FOLDER = "dbu6-hledger";

interface LoadedExport {
  files: HledgerExportFile[];
  journalCount: number;
}

/**
 * Downloads the books as hledger journal files, zipped: main.journal
 * declaring the accounts and including one file per bank or card, then the
 * journals outside them. The export is read when the page opens, so what it
 * holds shows before the download; the download reads it again, so it is
 * current.
 */
export function ExportHledger() {
  const [loaded, setLoaded] = useState<LoadedExport | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<LoadedExport> {
    const body = await hledgerExportApi.exportHledger();
    const next = { files: body.files, journalCount: body.journal_count };
    setLoaded(next);
    return next;
  }

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
  }, []);

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const { files } = await load();
      const encoder = new TextEncoder();
      const bytes = zip(
        files.map((file): [string, Uint8Array] => [
          `${FOLDER}/${file.path}`,
          encoder.encode(file.content),
        ]),
      );
      downloadBlob(
        `${FOLDER}-${today()}.zip`,
        new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppPage
      section="Advanced"
      title="Export your complete books in plain text"
    >
      <div className="p-5 max-w-4xl space-y-6">
        <div className="space-y-3 text-body text-ink-soft">
          <h1 className="text-title text-foreground">
            Download your entire book
          </h1>
          <p>
            Download your entire books as plain hledger text files. You can read
            or search them in any text editor, keep them in Git, or use them
            with hledger.
          </p>
          <p>
            It contains your entire chart of accounts and their transactions.
          </p>
          <p>
            <a
              className="text-primary underline"
              href="https://hledger.org"
              target="_blank"
              rel="noreferrer"
            >
              hledger
            </a>{" "}
            is free, open-source double-entry accounting software that keeps the
            books as plain text. It belongs to the{" "}
            <a
              className="text-primary underline"
              href="https://plaintextaccounting.org"
              target="_blank"
              rel="noreferrer"
            >
              plain-text accounting
            </a>{" "}
            tradition, an open, documented format that people have kept their
            books in for over two decades.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}

        {loaded && (
          <div className="grid items-start gap-6 md:grid-cols-[18rem_1fr]">
            <FactTable heading="In the export" rows={exportFacts(loaded)} />
            <div className="min-w-0">
              <div className="mb-2 text-label uppercase text-ink-meta">
                In the zip
              </div>
              <div className="rounded-control border border-sap-border">
                <table className="w-full table-fixed text-row">
                  <thead className="text-left text-meta text-ink-meta">
                    <tr>
                      <th scope="col" className="py-2.5 pl-4 pr-3 font-medium">
                        File
                      </th>
                      <th
                        scope="col"
                        className="w-36 py-2.5 pl-3 pr-4 text-right font-medium"
                      >
                        Transactions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.files.map((file) => (
                      <tr
                        key={file.path}
                        className="border-t border-line-inner"
                      >
                        <td className="truncate py-2 pl-4 pr-3 font-mono">
                          {file.path}
                        </td>
                        <td className="tnum py-2 pl-3 pr-4 text-right font-mono">
                          {holdsTransactions(file)
                            ? file.transaction_count
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div>
          <Button
            type="button"
            onClick={download}
            disabled={!loaded && !error}
            waiting={downloading ? "Exporting…" : undefined}
          >
            Download your books
          </Button>
        </div>

        <p className="border-t border-line-inner pt-4 text-body text-ink-soft">
          The final zip will also include a <code>verify.py</code> file for
          integrity verification. It runs hledger over the exported files and
          independently checks that every account balance and every Balance
          Sheet figure matches dbu6. Run it with <code>uv run verify.py</code>{" "}
          in the unzipped folder.
        </p>
      </div>
    </AppPage>
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Failed to export the books";
}

/** Counts and the span of dates the export holds, for the facts table. */
function exportFacts({ files, journalCount }: LoadedExport) {
  const main = files.find((file) => file.path === "main.journal");
  const accounts =
    main?.content.split("\n").filter((line) => line.startsWith("account "))
      .length ?? 0;
  const dates = files
    .filter(holdsTransactions)
    .flatMap((file) => transactionDates(file.content))
    .sort();
  return [
    { label: "Transactions", value: String(journalCount) },
    { label: "Accounts", value: String(accounts) },
    { label: "From", value: dates.length ? formatDate(dates[0]!) : "—" },
    { label: "To", value: dates.length ? formatDate(dates.at(-1)!) : "—" },
  ];
}

/** The dates of the transactions in a journal's text, each at a line's start. */
function transactionDates(content: string): string[] {
  return content.match(/^\d{4}-\d{2}-\d{2}(?=\s)/gm) ?? [];
}

/**
 * Whether the file is one of the journals that hold transactions, rather
 * than main.journal, the expected figures or the script that checks them.
 */
function holdsTransactions(file: HledgerExportFile): boolean {
  return file.path.endsWith(".journal") && file.path !== "main.journal";
}
