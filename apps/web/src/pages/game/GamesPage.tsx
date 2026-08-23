/**
 * Games list — the COURSE-ATTACHED game sets a logged-in learner can play,
 * reached through their enrollments (GET /api/games, mirroring GET /exams).
 * Each card links to the fullscreen play route. Tenant-authored college sets
 * are listed separately in the college workspace (Gaming section).
 */
import { Gamepad2 } from "lucide-react";

import { GameStatusCard } from "../../components/game/GameStatusCard.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";

export function GamesPage() {
  const { data, loading, error } = useQuery(() => api.games.list(), []);
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Games"
        description="Adaptive aptitude games from your courses. Correct answers raise the difficulty and the marks on offer."
      />

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No games yet"
          description="Games appear here when you're enrolled in a course that includes one."
          icon={<Gamepad2 />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <GameStatusCard key={item.id} item={item} href={`/play/game/${item.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
