/**
 * B2C / global composite runner (S30 B3) — the slug-free counterpart of
 * CollegeCommunicationRunnerPage, for a course-attached composite reached from
 * the learn-player launcher. Same view (parts, gates, running composite score),
 * but launch routes into the GLOBAL engine runners (`communicationRunnerPathGlobal`)
 * and completion returns HERE via `?from=/communication/:id` (Step 25 affordance,
 * B2C edition). The composite starts nothing — it only gates and reports.
 */
import type { CommunicationStudentPart } from "@codeapt/shared";
import { ArrowRight, CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api, parseApiError } from "../../lib/api-client.js";
import { communicationRunnerPathGlobal } from "../../lib/communication-launch.js";
import { useQuery } from "../../lib/use-query.js";

const STATUS: Record<
  CommunicationStudentPart["status"],
  { label: string; variant: "primary" | "neutral" | "success" | "warning" | "error" }
> = {
  available: { label: "Ready to start", variant: "primary" },
  in_progress: { label: "In progress", variant: "warning" },
  complete: { label: "Complete", variant: "success" },
  locked: { label: "Locked", variant: "neutral" },
  unavailable: { label: "Unavailable", variant: "error" },
};

export function CommunicationRunnerPage(): JSX.Element {
  const { assessmentId = "" } = useParams();
  const navigate = useNavigate();
  const view = useQuery(() => api.communication.student(assessmentId), [assessmentId]);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const launch = async (part: CommunicationStudentPart): Promise<void> => {
    setLaunchError(null);
    try {
      const res = await api.communication.launchPart(assessmentId, part.order);
      const from = `/communication/${assessmentId}`;
      navigate(communicationRunnerPathGlobal(res.partType, res.ref, from));
    } catch (err) {
      setLaunchError(parseApiError(err).message);
      view.refetch();
    }
  };

  if (view.loading) return <Skeleton className="h-64 w-full" />;
  if (view.error || !view.data) {
    return <Alert variant="error">Couldn’t load this assessment.</Alert>;
  }

  const v = view.data;
  const c = v.composite;
  const openable = new Set(["available", "in_progress", "complete"]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">{v.title}</h1>
        {v.description && <p className="text-sm text-ink-muted">{v.description}</p>}
      </div>

      {launchError && <Alert variant="error">{launchError}</Alert>}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div>
            <div className="text-3xl font-semibold text-ink">
              {c.compositePercent === null ? "—" : `${c.compositePercent}%`}
            </div>
            <div className="text-xs text-ink-muted">
              {c.partial
                ? `Partial — ${c.scoredCount} of ${c.totalCount} parts scored`
                : "Overall"}
            </div>
          </div>
          <div className="ml-auto text-xs text-ink-muted">
            Pass {v.passPercentage}% · Distinction {v.distinctionPercentage}%
          </div>
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {v.parts.map((p) => {
          const meta = STATUS[p.status];
          return (
            <li key={p.order}>
              <Card>
                <CardContent className="flex items-start gap-4 p-5">
                  <div className="mt-0.5">
                    {p.status === "complete" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : p.status === "unavailable" ? (
                      <CircleAlert className="h-5 w-5 text-red-600" />
                    ) : p.status === "locked" ? (
                      <Lock className="h-5 w-5 text-ink-muted" />
                    ) : (
                      <span className="text-sm font-medium text-ink-muted">
                        {p.order + 1}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{p.label}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-[11px] uppercase text-ink-muted">
                        {p.partType}
                      </span>
                    </div>
                    {p.reason && <p className="mt-1 text-sm text-ink-muted">{p.reason}</p>}
                    {p.percent !== null && (
                      <p className="mt-1 text-sm text-ink">
                        Score: {p.percent}%{p.band ? ` (${p.band})` : ""}
                      </p>
                    )}
                  </div>
                  {openable.has(p.status) && (
                    <Button
                      size="sm"
                      variant={p.status === "complete" ? "outline" : "primary"}
                      onClick={() => void launch(p)}
                    >
                      {p.status === "complete" ? "Review" : "Start"}
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default CommunicationRunnerPage;
