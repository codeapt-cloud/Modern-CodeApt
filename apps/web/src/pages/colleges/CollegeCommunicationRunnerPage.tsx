/**
 * Student view of ONE communication composite (Step 21) — the single entry point
 * showing the whole assessment: every part, which is done / next / locked (and
 * WHY), and the running composite score. Starting an open part routes into the
 * EXISTING engine runner (exam / essay / speaking), unchanged — the composite
 * only gates and reports. A part not yet taken shows no score (never a zero); an
 * incomplete composite is labelled partial, not a low mark.
 */
import {
  CollegeFeature,
  checkEntitlement,
  type CommunicationPartType,
  type CommunicationStudentPart,
} from "@codeapt/shared";
import { ArrowRight, Lock, CircleAlert, CheckCircle2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

/** Where each part type's EXISTING runner lives (composite never re-implements). */
function runnerPath(
  slug: string,
  partType: CommunicationPartType,
  ref: string,
): string {
  if (partType === "exam") return `/exam/${ref}`;
  if (partType === "essay") return `/essays/${ref}`;
  // Speaking is a list-and-pick page (no per-id route) — land there; the student
  // opens the matching paper. (The one entry-point asymmetry across engines.)
  return `/c/${slug}/speaking`;
}

const STATUS: Record<
  CommunicationStudentPart["status"],
  {
    label: string;
    variant: "primary" | "neutral" | "success" | "warning" | "error";
  }
> = {
  available: { label: "Ready to start", variant: "primary" },
  in_progress: { label: "In progress", variant: "warning" },
  complete: { label: "Complete", variant: "success" },
  locked: { label: "Locked", variant: "neutral" },
  unavailable: { label: "Unavailable", variant: "error" },
};

export function CollegeCommunicationRunnerPage() {
  const { slug, context } = useCollege();
  const { assessmentId = "" } = useParams();
  const navigate = useNavigate();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
  );

  const view = useQuery(
    () =>
      entitled
        ? api.collegeCommunication.student(slug, assessmentId)
        : Promise.reject(new Error("not entitled")),
    [slug, assessmentId, entitled],
  );

  const launch = async (part: CommunicationStudentPart): Promise<void> => {
    // Re-check the gate server-side, then route into the engine runner.
    const res = await api.collegeCommunication.launchPart(
      slug,
      assessmentId,
      part.order,
    );
    navigate(runnerPath(slug, res.partType, res.ref));
  };

  if (!entitled) {
    return (
      <Alert variant="info">Your college hasn’t enabled Communication.</Alert>
    );
  }
  if (view.loading) return <Skeleton className="h-64 w-full" />;
  if (view.error || !view.data) {
    return <Alert variant="error">Couldn’t load this assessment.</Alert>;
  }

  const v = view.data;
  const c = v.composite;
  const openable = new Set(["available", "in_progress", "complete"]);

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate(`/c/${slug}/communication`)}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Communication
        </button>
        <h1 className="mt-1 text-xl font-semibold text-ink">{v.title}</h1>
        {v.description && (
          <p className="text-sm text-ink-muted">{v.description}</p>
        )}
      </div>

      {/* Composite score — a running subtotal while parts remain. */}
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
          <div>
            {c.band ? (
              <Badge
                variant={
                  c.band === "distinction"
                    ? "success"
                    : c.band === "pass"
                      ? "primary"
                      : "error"
                }
              >
                {c.band === "distinction"
                  ? "Distinction"
                  : c.band === "pass"
                    ? "Pass"
                    : "Fail"}
              </Badge>
            ) : (
              <span className="text-xs text-ink-muted">
                A band is awarded once every part is complete.
              </span>
            )}
          </div>
          <div className="ml-auto text-xs text-ink-muted">
            Pass {v.passPercentage}% · Distinction {v.distinctionPercentage}%
          </div>
        </CardContent>
      </Card>

      {/* The ordered parts. */}
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
                    {p.reason && (
                      <p className="mt-1 text-sm text-ink-muted">{p.reason}</p>
                    )}
                    {p.percent !== null && (
                      <p className="mt-1 text-sm text-ink">
                        Score: {p.percent}%
                        {p.band ? ` (${p.band})` : ""}
                        {p.approximate && (
                          <span className="ml-2 text-xs text-amber-600">
                            AI-assisted — approximate
                          </span>
                        )}
                        {p.deterministicFallback && (
                          <span className="ml-2 text-xs text-ink-muted">
                            scored on the deterministic floor (not marked down)
                          </span>
                        )}
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

export default CollegeCommunicationRunnerPage;
