/**
 * College student mock-interview page (Step 34). Lists published interviews the
 * student's cohort can reach, then hands off to the shared InterviewSession
 * (pre-flight → intake → run → report). Mirrors CollegeSpeakingPage. Gated by the
 * INTERVIEW feature; "Manage" links to the authoring page for faculty.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Settings2 } from "lucide-react";
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
  const canAuthor = checkEntitlement(context.entitlements, CollegeFeature.INTERVIEW, "interview");
  const [picked, setPicked] = useState<{ id: string; role: string } | null>(null);

  const list = useQuery(
    () => (entitled ? api.collegeInterview.available(slug) : Promise.resolve({ items: [] })),
    [slug, entitled],
  );

  if (!entitled) {
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Mock interviews</h1>
          <p className="text-sm text-ink-muted">
            Practice a real interview: the interviewer asks, you answer aloud, and you
            get a scored report. Your camera is optional and never affects your score.
          </p>
        </div>
        {canAuthor ? (
          <Button asChild variant="secondary" size="sm">
            <Link to={`/c/${slug}/interviews/manage`}>
              <Settings2 className="mr-2 h-4 w-4" /> Manage
            </Link>
          </Button>
        ) : null}
      </div>

      {list.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Nothing assigned yet" description="No mock interviews are published for your cohort." />
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
                <Button
                  disabled={iv.maxAttempts > 0 && iv.attemptsUsed >= iv.maxAttempts}
                  onClick={() => setPicked({ id: iv.id, role: iv.role })}
                >
                  Start
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default CollegeInterviewPage;
