/**
 * College student mock-interview page (Step 34). Lists published interviews the
 * student's cohort can reach, then hands off to the shared InterviewSession
 * (pre-flight → intake → run → report). Mirrors CollegeSpeakingPage. Gated by the
 * INTERVIEW feature; "Manage" links to the authoring page for faculty.
 */
import {
  CollegeFeature,
  COLLEGE_ADMIN_ROLES,
  FACULTY_ROLES,
  checkEntitlement,
  isPlatformAdmin,
} from "@codeapt/shared";
import { Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { InterviewSession } from "../../components/interview/InterviewSession.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { collegeInterviewEngine } from "../../lib/interview-engine.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeInterviewPage(): JSX.Element {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.INTERVIEW);
  // Authoring & management is for college admins, platform admins, and faculty.
  // Never students. Platform admins bypass entitlements. College admins need the
  // INTERVIEW feature. Faculty additionally check the "interview" sub-capability.
  const isPlatform = isPlatformAdmin(context.membership.role);
  const isCollegeAdmin = COLLEGE_ADMIN_ROLES.includes(context.membership.role);
  const isFaculty = FACULTY_ROLES.includes(context.membership.role);
  const canAuthor =
    isPlatform ||
    (isCollegeAdmin && checkEntitlement(context.entitlements, CollegeFeature.INTERVIEW)) ||
    (isFaculty && checkEntitlement(context.entitlements, CollegeFeature.INTERVIEW, "interview"));
  const [picked, setPicked] = useState<{ id: string; role: string } | null>(null);

  const list = useQuery(
    () => (entitled ? api.collegeInterview.available(slug) : Promise.resolve({ items: [] })),
    [slug, entitled],
  );

  if (!entitled && !isPlatform) {
    return <Alert variant="info">Your college hasn’t enabled mock interviews yet.</Alert>;
  }

  if (picked) {
    const engine = collegeInterviewEngine(slug);
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
          ← Back to interviews
        </Button>
        <InterviewSession
          engine={engine}
          defaultRole={picked.role}
          start={(v) => api.collegeInterview.start(slug, picked.id, v)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Mock interviews</h1>
          <p className="text-sm text-ink-muted">
            Practice a real interview: the interviewer asks, you answer aloud, and you
            get a scored report. Your camera is optional and never affects your score.
          </p>
        </div>
        {canAuthor ? (
          <Button asChild size="sm" className="self-start">
            <Link to={`/c/${slug}/interviews/manage`}>
              <Settings2 className="mr-2 h-4 w-4" /> Manage interviews
            </Link>
          </Button>
        ) : null}
      </div>

      {list.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Settings2 />}
          title={canAuthor ? "No mock interviews created yet" : "Nothing assigned yet"}
          description={
            canAuthor
              ? "Create and publish mock interviews with custom roles, questions, and duration for your cohorts to practice."
              : "No mock interviews are published for your cohort."
          }
          action={
            canAuthor ? (
              <Button asChild>
                <Link to={`/c/${slug}/interviews/manage`}>
                  <Plus className="mr-2 h-4 w-4" /> Create &amp; manage interviews
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {list.data?.items.map((iv) => (
            <Card key={iv.id}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="font-medium text-ink">{iv.title}</div>
                  <p className="text-sm text-ink-muted">
                    {iv.role}
                    {iv.seniority ? ` · ${iv.seniority}` : ""} · {iv.durationMinutes} min ·{" "}
                    {iv.maxAttempts === 0 ? "unlimited attempts" : `${iv.attemptsUsed}/${iv.maxAttempts} used`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canAuthor ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/c/${slug}/interviews/manage`}>
                        <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    disabled={iv.maxAttempts > 0 && iv.attemptsUsed >= iv.maxAttempts}
                    onClick={() => setPicked({ id: iv.id, role: iv.role })}
                  >
                    Start
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default CollegeInterviewPage;
