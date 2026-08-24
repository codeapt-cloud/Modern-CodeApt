/**
 * Communication composite COHORT view (Step 21) — the operator's single table
 * that replaces the four manual joins: one row per student × each part × the
 * composite, plus the ONE .xlsx export. Honest cells: a part a student hasn't
 * scored shows "—" (never a fake 0); an incomplete composite is marked partial.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { triggerBlobDownload } from "../../lib/download.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const cell = (v: number | null): string => (v === null ? "—" : `${v}%`);

export function CollegeCommunicationCohortPage() {
  const { slug, context } = useCollege();
  const { assessmentId = "" } = useParams();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const canAuthor = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
    "authoring",
  );

  const report = useQuery(
    () =>
      canAuthor
        ? api.collegeCommunication.cohort(slug, assessmentId)
        : Promise.reject(new Error("no access")),
    [slug, assessmentId, canAuthor],
  );

  const download = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError(null);
    try {
      triggerBlobDownload(
        await api.collegeCommunication.exportCohort(slug, assessmentId),
      );
    } catch (err) {
      setDownloadError(parseApiError(err).message);
    } finally {
      setDownloading(false);
    }
  };

  if (!canAuthor) {
    return <Alert variant="info">You don’t have communication authoring access.</Alert>;
  }
  if (report.loading) return <Skeleton className="h-64 w-full" />;
  if (report.error || !report.data) {
    return <Alert variant="error">Couldn’t load the cohort report.</Alert>;
  }
  const r = report.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(`/c/${slug}/communication/assessments`)}
            className="text-sm text-ink-muted hover:text-ink"
          >
            ← Assessments
          </button>
          <h1 className="mt-1 text-xl font-semibold text-ink">{r.title} — cohort</h1>
          <p className="text-sm text-ink-muted">{r.rows.length} students</p>
        </div>
        <Button onClick={() => void download()} disabled={downloading}>
          <Download className="mr-1 h-4 w-4" />
          {downloading ? "Preparing…" : "Export .xlsx"}
        </Button>
      </div>

      {downloadError && (
        <Alert variant="error">Couldn’t export: {downloadError}</Alert>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-subtle text-left text-ink-muted">
                <th className="p-3">Roll</th>
                <th className="p-3">Student</th>
                {r.parts.map((p) => (
                  <th key={p.order} className="p-3">{p.label}</th>
                ))}
                <th className="p-3">Composite</th>
                <th className="p-3">Progress</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => {
                const byOrder = new Map(row.cells.map((c) => [c.order, c]));
                return (
                  <tr key={row.userId} className="border-b border-subtle/60">
                    <td className="p-3 font-mono text-xs">{row.rollNumber}</td>
                    <td className="p-3">{row.userName}</td>
                    {r.parts.map((p) => {
                      const c = byOrder.get(p.order);
                      return (
                        <td key={p.order} className="p-3">
                          {c ? cell(c.percent) : "—"}
                          {c?.band && (
                            <span className="ml-1 text-xs text-ink-muted">
                              ({c.band})
                            </span>
                          )}
                          {c && c.percent !== null && c.attemptCount > 1 && (
                            <span className="ml-1 text-xs text-ink-muted">
                              best of {c.attemptCount}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3 font-medium text-ink">
                      {row.composite.compositePercent === null
                        ? "—"
                        : `${row.composite.compositePercent}%`}
                      {row.composite.partial && (
                        <span className="ml-1 text-xs text-ink-muted">(partial)</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-ink-muted">
                      {row.composite.scoredCount}/{row.composite.totalCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

export default CollegeCommunicationCohortPage;
