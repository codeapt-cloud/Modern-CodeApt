/**
 * College mock-interview cohort report + xlsx export (Step 34). Mirrors
 * CollegeCommunicationCohortPage: one row per student (best attempt), the five
 * dimensions + overall + score source, and a blob download of the .xlsx.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { triggerBlobDownload } from "../../lib/download.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const cell = (v: number | null): string => (v === null ? "—" : `${v}`);

export function CollegeInterviewCohortPage(): JSX.Element {
  const { slug, context } = useCollege();
  const { assessmentId = "" } = useParams();
  const canAuthor = checkEntitlement(context.entitlements, CollegeFeature.INTERVIEW, "interview");
  const report = useQuery(
    () =>
      canAuthor
        ? api.collegeInterview.cohort(slug, assessmentId)
        : Promise.reject(new Error("Not authorized")),
    [slug, assessmentId, canAuthor],
  );
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError(null);
    try {
      triggerBlobDownload(await api.collegeInterview.exportCohort(slug, assessmentId));
    } catch (err) {
      setDownloadError(parseApiError(err).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {report.data?.title ?? "Cohort"} — results
          </h1>
          {report.data ? (
            <p className="text-sm text-ink-muted">{report.data.role}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/c/${slug}/interviews/manage`}>Back</Link>
          </Button>
          <Button size="sm" onClick={() => void download()} disabled={downloading || !report.data}>
            <Download className="mr-2 h-4 w-4" /> {downloading ? "Preparing…" : "Export .xlsx"}
          </Button>
        </div>
      </div>

      {downloadError ? <Alert variant="error">{downloadError}</Alert> : null}
      {report.error ? <Alert variant="error">{report.error}</Alert> : null}

      {report.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : report.data ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-subtle text-left text-ink-muted">
                <tr>
                  {["Roll", "Student", "Attempts", "Overall", "Speaking", "Vocabulary", "Concept", "Analysis", "Topic", "Source"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-subtle/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.rollNumber || "—"}</td>
                    <td className="px-3 py-2">{r.userName || "—"}</td>
                    <td className="px-3 py-2">{r.attempts}</td>
                    <td className="px-3 py-2 font-mono">{cell(r.bestOverall)}</td>
                    <td className="px-3 py-2 font-mono">{cell(r.speaking)}</td>
                    <td className="px-3 py-2 font-mono">{cell(r.vocabulary)}</td>
                    <td className="px-3 py-2 font-mono">{cell(r.concept)}</td>
                    <td className="px-3 py-2 font-mono">{cell(r.analysis)}</td>
                    <td className="px-3 py-2 font-mono">{cell(r.topicKnowledge)}</td>
                    <td className="px-3 py-2 text-xs">{r.source ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default CollegeInterviewCohortPage;
