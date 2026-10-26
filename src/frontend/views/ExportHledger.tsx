import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { appTimeZone } from "@sapporta/frontend";
import { AppPage } from "@sapporta/frontend/shell";
import { Temporal } from "@sapporta/shared/temporal";
import type { HledgerExportFile } from "../../shared/index";
import { hledgerExportApi } from "../api";
import { Button } from "../components/ui/button";
import { downloadBlob, zip } from "../zip";

const FOLDER = "dbu6-hledger";

/**
 * Downloads the books as hledger journal files, zipped: main.journal
 * declaring the accounts and including one file per bank or card, then the
 * journals outside them. The files are listed once downloaded.
 */
export function ExportHledger() {
  const [files, setFiles] = useState<HledgerExportFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const body = await hledgerExportApi.exportHledger();
      const encoder = new TextEncoder();
      const bytes = zip(
        body.files.map((file): [string, Uint8Array] => [
          `${FOLDER}/${file.path}`,
          encoder.encode(file.content),
        ]),
      );
      const today = Temporal.Now.plainDateISO(appTimeZone()).toString();
      downloadBlob(
        `${FOLDER}-${today}.zip`,
        new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
      );
      setFiles(body.files);
    } catch (e) {
      setFiles(null);
      setError(e instanceof Error ? e.message : "Failed to export the books");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppPage section="Advanced" title="Export as hledger">
      <div className="p-5 max-w-4xl space-y-4">
        <p className="text-body text-ink-soft">
          Every posted journal as hledger files: <code>main.journal</code>{" "}
          includes one file per bank or card, then the rest.
        </p>

        <div>
          <Button
            type="button"
            onClick={download}
            waiting={loading ? "Exporting…" : undefined}
          >
            Download hledger journals
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-card border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
            <div className="text-row text-destructive break-words">{error}</div>
          </div>
        )}

        {files && !loading && (
          <div className="rounded-card border bg-card">
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
                {files.map((file) => (
                  <tr key={file.path} className="border-t border-line-inner">
                    <td className="truncate py-2 pl-4 pr-3 font-mono">
                      {file.path}
                    </td>
                    <td className="tnum py-2 pl-3 pr-4 text-right font-mono">
                      {holdsTransactions(file) ? file.transaction_count : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {files && !loading && (
          <p className="text-meta text-ink-meta">
            Check it: in the unzipped folder, run <code>uv run verify.py</code>.
          </p>
        )}
      </div>
    </AppPage>
  );
}

/**
 * Whether the file is one of the journals that hold transactions, rather
 * than main.journal, the expected figures or the script that checks them.
 */
function holdsTransactions(file: HledgerExportFile): boolean {
  return file.path.endsWith(".journal") && file.path !== "main.journal";
}
