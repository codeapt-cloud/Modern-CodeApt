/**
 * B2C / course-attached mock-interview runner page (Step 34). Launched with an
 * assessment id (from the learn player or a deep link). Uses the slug-free global
 * engine + the shared InterviewSession. Mirrors SpeakingRunnerPage.
 */
import { ArrowLeft } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { InterviewSession } from "../../components/interview/InterviewSession.js";
import { Alert } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { api } from "../../lib/api-client.js";
import { globalInterviewEngine } from "../../lib/interview-engine.js";
import { safeReturnPath } from "../../lib/return-to.js";

export function InterviewRunnerPage(): JSX.Element {
  const { assessmentId = "" } = useParams();
  const [params] = useSearchParams();
  const returnTo = safeReturnPath(params.get("from"));
  const engine = globalInterviewEngine();

  if (!assessmentId) {
    return <Alert variant="error">No interview specified.</Alert>;
  }

  return (
    <div className="space-y-4">
      {returnTo ? (
        <Button asChild variant="ghost" size="sm">
          <Link to={returnTo}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Link>
        </Button>
      ) : null}
      <InterviewSession
        engine={engine}
        defaultRole=""
        start={(v) => api.interview.start(assessmentId, v)}
      />
    </div>
  );
}

export default InterviewRunnerPage;
