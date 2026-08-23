/**
 * College student Gaming page — the published, cohort-targeted game sets their
 * college has assigned (GET /c/:slug/game-sets/available). Reuses the same
 * GameStatusCard + fullscreen runner as the course-attached games; only the
 * list + start endpoints are tenant-scoped (?c=<slug> on the play route).
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Gamepad2 } from "lucide-react";

import { GameStatusCard } from "../../components/game/GameStatusCard.js";
import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeGamingPage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.GAMING);

  const { data, loading, error } = useQuery(
    () =>
      entitled
        ? api.collegeGames.available(slug)
        : Promise.resolve({ items: [] }),
    [slug, entitled],
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Games</h1>
        <p className="text-sm text-ink-muted">
          Adaptive aptitude games assigned to your cohort.
        </p>
      </div>

      {!entitled ? (
        <Alert variant="info">
          Your college hasn’t enabled Gaming yet.
        </Alert>
      ) : loading ? (
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
          title="No games assigned"
          description="Games appear here once your college publishes one for your cohort."
          icon={<Gamepad2 />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <GameStatusCard
              key={item.id}
              item={item}
              href={`/play/game/${item.id}?c=${encodeURIComponent(slug)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
