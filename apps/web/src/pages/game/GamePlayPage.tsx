/**
 * Fullscreen game play route (`/play/game/:gameSetId`, optional `?c=<slug>` for a
 * tenant set) — outside the app shell, like the exam runner. It resolves the
 * set's title + game keys from the appropriate list (course-attached vs tenant),
 * then hands a START thunk to <GameRunner>, which owns everything from there.
 * START is deferred inside the runner (to the tutorial's Start) so the server's
 * serve-time clock doesn't run during the tutorial.
 */
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { GameRunner } from "../../components/game/GameRunner.js";
import { Button } from "../../components/ui/button.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";

export function GamePlayPage() {
  const { gameSetId = "" } = useParams();
  const [params] = useSearchParams();
  const collegeSlug = params.get("c");
  const navigate = useNavigate();

  // Resolve the set from the list the caller reached it through.
  const { data, loading } = useQuery(
    async () => {
      const res = collegeSlug
        ? await api.collegeGames.available(collegeSlug)
        : await api.games.list();
      return res.items.find((i) => i.id === gameSetId) ?? null;
    },
    [gameSetId, collegeSlug],
  );

  const exitHref = collegeSlug ? `/c/${collegeSlug}/gaming` : "/games";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="mb-4 text-ink">
          This game set isn’t available to you right now.
        </p>
        <Button onClick={() => navigate(exitHref)}>Back to games</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base">
      <GameRunner
        title={data.title}
        gameKeys={data.gameKeys}
        start={() =>
          collegeSlug
            ? api.collegeGames.start(collegeSlug, gameSetId)
            : api.games.start(gameSetId)
        }
        onExit={() => navigate(exitHref)}
      />
    </div>
  );
}
