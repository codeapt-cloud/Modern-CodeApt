/**
 * My history (B2C / individual learner surface, route: /history). The learner's
 * OWN attempts across every module — exams, speaking, communication composites,
 * essays and games — with scores, via the unified `/me/history` read (non-college
 * attempts). Uses the shared <AttemptHistory> list (same component the college
 * "My results" page uses). This is net-new for B2C, which previously had only the
 * dashboard summary cards and no way to review past attempt scores.
 */
import { PageHeader } from "../components/layout/PageHeader.js";
import { AttemptHistory } from "../components/history/AttemptHistory.js";
import { api } from "../lib/api-client.js";
import { useQuery } from "../lib/use-query.js";

export function HistoryPage() {
  const history = useQuery(() => api.me.history(), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My history"
        description="Every exam, speaking test, essay, and game you've attempted — with your scores."
      />
      <AttemptHistory
        entries={history.data?.entries ?? []}
        loading={history.loading}
        error={history.error}
        surface="b2c"
      />
    </div>
  );
}

export default HistoryPage;
