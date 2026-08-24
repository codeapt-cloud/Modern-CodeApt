/**
 * Gaming COHORT view (Step 24 G2) — the operator's single table for one game set:
 * one row per cohort student with PER-GAME columns (the TRUE raw score — a
 * negative grid_challenge value is shown, not clamped), the composite, attempt
 * count, and status, plus the ONE .xlsx export and an all-attempts list below.
 * Honest cells: a student who never played shows "—" (never a fake 0); an
 * in-progress attempt reads "in progress", an abandoned one "abandoned". Mirrors
 * CollegeCommunicationCohortPage.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type GameSetAttemptStatus,
} from "@codeapt/shared";
import { Download } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { triggerBlobDownload } from "../../lib/download.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

const STATUS_META: Record<
  GameSetAttemptStatus,
  { label: string; variant: "success" | "warning" | "error" }
> = {
  graded: { label: "Graded", variant: "success" },
  in_progress: { label: "In progress", variant: "warning" },
  abandoned: { label: "Abandoned", variant: "error" },
};

function StatusBadge({
  status,
}: {
  status: GameSetAttemptStatus | null;
}): JSX.Element {
  if (status === null) return <span className="text-ink-muted">—</span>;
  const m = STATUS_META[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function CollegeGameCohortPage(): JSX.Element {
  const { slug, context } = useCollege();
  const { gameSetId = "" } = useParams();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const canAuthor = checkEntitlement(context.entitlements, CollegeFeature.GAMING);

  const report = useQuery(
    () =>
      canAuthor
        ? api.collegeGames.cohort(slug, gameSetId)
        : Promise.reject(new Error("no access")),
    [slug, gameSetId, canAuthor],
  );
  const attempts = useQuery(
    () =>
      canAuthor
        ? api.collegeGames.attempts(slug, gameSetId)
        : Promise.reject(new Error("no access")),
    [slug, gameSetId, canAuthor],
  );

  const download = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError(null);
    try {
      triggerBlobDownload(await api.collegeGames.exportCohort(slug, gameSetId));
    } catch (err) {
      setDownloadError(parseApiError(err).message);
    } finally {
      setDownloading(false);
    }
  };

  if (!canAuthor) {
    return <Alert variant="info">Your college hasn’t enabled Gaming.</Alert>;
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
            onClick={() => navigate(`/c/${slug}/gaming`)}
            className="text-sm text-ink-muted hover:text-ink"
          >
            ← Game sets
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
                {r.games.map((g) => (
                  <th key={g.gameIndex} className="p-3">
                    {g.gameKey}
                  </th>
                ))}
                <th className="p-3">Composite</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => {
                const byGame = new Map(row.cells.map((c) => [c.gameIndex, c]));
                return (
                  <tr key={row.userId} className="border-b border-subtle/60">
                    <td className="p-3 font-mono text-xs">{row.rollNumber}</td>
                    <td className="p-3">{row.userName}</td>
                    {r.games.map((g) => {
                      const c = byGame.get(g.gameIndex);
                      return (
                        <td key={g.gameIndex} className="p-3">
                          {c && c.played && c.rawScore !== null
                            ? c.rawScore
                            : "—"}
                        </td>
                      );
                    })}
                    <td className="p-3 font-medium text-ink">
                      {row.compositeScore === null ? "—" : row.compositeScore}
                    </td>
                    <td className="p-3 text-xs text-ink-muted">
                      {row.attemptCount}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Every attempt (incl. abandoned), for full operator visibility. */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">All attempts</h2>
        {attempts.loading ? (
          <Skeleton className="h-32 w-full" />
        ) : attempts.error || !attempts.data ? (
          <Alert variant="error">Couldn’t load the attempt list.</Alert>
        ) : attempts.data.items.length === 0 ? (
          <p className="text-sm text-ink-muted">No attempts yet.</p>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle text-left text-ink-muted">
                    <th className="p-3">Roll</th>
                    <th className="p-3">Student</th>
                    <th className="p-3">Started</th>
                    <th className="p-3">Composite</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Integrity</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.data.items.map((a) => (
                    <tr key={a.attemptId} className="border-b border-subtle/60">
                      <td className="p-3 font-mono text-xs">{a.rollNumber}</td>
                      <td className="p-3">{a.userName}</td>
                      <td className="p-3 text-xs text-ink-muted">
                        {new Date(a.startedAt).toLocaleString()}
                      </td>
                      <td className="p-3">
                        {a.compositeScore === null ? "—" : a.compositeScore}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="p-3 text-xs">
                        {a.isMalpractice ? (
                          <span className="text-red-600">
                            malpractice ({a.warningsTriggered} warnings)
                          </span>
                        ) : a.warningsTriggered > 0 ? (
                          <span className="text-amber-600">
                            {a.warningsTriggered} warnings
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default CollegeGameCohortPage;
