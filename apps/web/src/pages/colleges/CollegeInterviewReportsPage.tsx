/**
 * College mock-interview REPORTS — the operator's attempt monitor + individual
 * report drill-down. Lists every attempt on one interview (student, status,
 * overall) and opens any one's full scored report (per-dimension + transcript)
 * via the shared InterviewResults, fed by the operator report endpoint. Reaches
 * here from the Manage list ("Reports") and the Analytics hub. Author-gated.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { InterviewResults } from "../../components/interview/InterviewResults.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const pct = (v: number | null): string => (v === null ? "—" : `${v}%`);
const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : "—";

export function CollegeInterviewReportsPage(): JSX.Element {
  const { slug, context } = useCollege();
  const { assessmentId = "" } = useParams();
  const canView = checkEntitlement(context.entitlements, CollegeFeature.INTERVIEW, "interview");
  const attempts = useQuery(
    () =>
      canView
        ? api.collegeInterview.listAttempts(slug, assessmentId)
        : Promise.reject(new Error("Not authorized")),
    [slug, assessmentId, canView],
  );
  const [open, setOpen] = useState<string | null>(null);

  if (open) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
          ← Back to attempts
        </Button>
        <InterviewResults
          attemptId={open}
          loadResult={(id) => api.collegeInterview.attemptReport(slug, assessmentId, id)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Interview reports</h1>
          <p className="text-sm text-ink-muted">
            Every student attempt. Open one to see its full scored report and transcript.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/c/${slug}/interviews/manage`}>Back</Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to={`/c/${slug}/interviews/${assessmentId}/cohort`}>Cohort summary</Link>
          </Button>
        </div>
      </div>

      {attempts.error ? <Alert variant="error">{attempts.error}</Alert> : null}

      {attempts.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (attempts.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No attempts yet" description="No student has taken this interview." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-subtle text-left text-ink-muted">
                <tr>
                  {["Roll", "Student", "Status", "Overall", "Source", "Started", "Scored", ""].map(
                    (h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {attempts.data?.items.map((a) => (
                  <tr key={a.attemptId} className="border-b border-subtle/60">
                    <td className="px-3 py-2 font-mono text-xs">{a.rollNumber || "—"}</td>
                    <td className="px-3 py-2">
                      {a.userName || "—"}
                      {a.flagged ? (
                        <Badge variant="error" className="ml-2">
                          flagged
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={a.status === "scored" ? "success" : "neutral"}>
                        {a.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono">{pct(a.overall)}</td>
                    <td className="px-3 py-2 text-xs">{a.source}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">{when(a.startedAt)}</td>
                    <td className="px-3 py-2 text-xs text-ink-muted">{when(a.scoredAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setOpen(a.attemptId)}>
                        View report
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default CollegeInterviewReportsPage;
