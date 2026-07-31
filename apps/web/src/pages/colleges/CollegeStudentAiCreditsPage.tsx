/**
 * My AI credits (student space, route: /c/:slug/ai-credits for a college student)
 * — the student's OWN allocation this period: allocated / used / remaining, with
 * an honest "no credits — ask your administrator" state when the college hasn't
 * allocated to them (or they're exhausted). Read-only, own-data-only. AI-gated.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { Coins } from "lucide-react";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Card } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-subtle bg-surface-base px-4 py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-mono text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}

export function CollegeStudentAiCreditsPage() {
  const { slug, context } = useCollege();
  const entitled = checkEntitlement(context.entitlements, CollegeFeature.AI);
  const q = useQuery(
    () => (entitled ? api.aiCreditDistribution.mine(slug) : Promise.resolve(null)),
    [slug, entitled],
  );

  if (!entitled) {
    return (
      <div className="space-y-6">
        <PageHeader title="My AI credits" description="Your AI credit allocation." />
        <Card className="mx-auto max-w-lg space-y-3 p-8 text-center">
          <Coins className="mx-auto h-10 w-10 text-ink-muted" />
          <h2 className="text-lg font-semibold text-ink">AI isn&apos;t enabled</h2>
          <p className="text-sm text-ink-muted">Your college doesn&apos;t have the AI feature.</p>
        </Card>
      </div>
    );
  }

  const data = q.data;
  // Not in per-student mode → the college manages AI centrally; nothing personal.
  const poolManaged = data !== null && data !== undefined && !data.enabled;
  // In per-student mode but never allocated → honest "no credits" state.
  const noAllocation =
    data?.enabled === true && (data.allocated === null || data.allocated === 0);
  const exhausted =
    data?.enabled === true && (data.allocated ?? 0) > 0 && data.remaining === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My AI credits"
        description="Your AI credit allocation for this period."
      />

      {q.loading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : q.error ? (
        <Alert variant="error">{q.error}</Alert>
      ) : !data ? null : poolManaged ? (
        <Alert variant="info">
          Your college manages AI credits centrally — you don&apos;t have a personal
          allocation. AI features draw from the college&apos;s shared pool.
        </Alert>
      ) : (
        <>
          {noAllocation ? (
            <Alert variant="warning">
              You have no AI credits yet — ask your administrator to allocate some.
            </Alert>
          ) : exhausted ? (
            <Alert variant="warning">
              You&apos;ve used all your AI credits for this period — ask your
              administrator for more.
            </Alert>
          ) : null}

          <Card className="grid grid-cols-3 gap-3 p-5">
            <Stat label="Allocated" value={data.allocated ?? 0} />
            <Stat label="Used" value={data.consumed} />
            <Stat label="Remaining" value={data.remaining} />
          </Card>
          <p className="text-xs text-ink-muted">
            Credits reset each month; unused credits don&apos;t roll over.
          </p>
        </>
      )}
    </div>
  );
}
