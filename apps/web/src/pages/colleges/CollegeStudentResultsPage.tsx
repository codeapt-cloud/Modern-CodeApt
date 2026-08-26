/**
 * My results / history (student space, route: /c/:slug/results). Shows this
 * student's OWN attempts across EVERY module — exams, speaking, communication
 * composites, essays and games — with scores, via the unified `/c/:slug/history`
 * read (scoped to this college). Replaces the earlier exams+essays-only client
 * aggregation with the server aggregate; the presentational list is the shared
 * <AttemptHistory> (also used by the B2C surface). Member-open, empty until the
 * student has attempted something. A speaking attempt re-scored through Whisper
 * surfaces the authoritative grade here without a new page (Step 32 tier-2).
 */
import { PageHeader } from "../../components/layout/PageHeader.js";
import { AttemptHistory } from "../../components/history/AttemptHistory.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeStudentResultsPage() {
  const { slug } = useCollege();
  const history = useQuery(() => api.collegeHistory.get(slug), [slug]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My results"
        description="Your scores across every assessment you've attempted in this college."
      />
      <AttemptHistory
        entries={history.data?.entries ?? []}
        loading={history.loading}
        error={history.error}
        surface="college"
        slug={slug}
      />
    </div>
  );
}
