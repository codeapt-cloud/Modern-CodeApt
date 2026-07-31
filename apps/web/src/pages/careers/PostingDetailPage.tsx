/**
 * Posting detail (route: /careers/:id). The primary action branches on the
 * posting's applyUrl + open state + the caller's own application:
 *   external → "Apply on company site" (new tab, noopener noreferrer)
 *   apply    → opens the in-app apply form
 *   status   → shows the caller's application status (no dead-end button)
 *   closed   → "Applications closed" (disabled)
 * Description/requirements render through the safe Markdown renderer (no raw
 * HTML). See lib/careers-ui for the pure affordance selector.
 */
import type { PostingDetail } from "@codeapt/shared";
import {
  ArrowLeft,
  Briefcase,
  CalendarClock,
  ExternalLink,
  MapPin,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { ApplyDialog } from "../../components/careers/ApplyDialog.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Markdown } from "../../components/player/Markdown.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Spinner } from "../../components/ui/spinner.js";
import { api } from "../../lib/api-client.js";
import {
  applyAffordance,
  postingTypeLabel,
  statusBadgeVariant,
  statusLabel,
} from "../../lib/careers-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { useAuth } from "../../providers/AuthProvider.js";

function MetaRow({ posting }: { posting: PostingDetail }) {
  const deadline = posting.deadline
    ? new Date(posting.deadline).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
      <span className="inline-flex items-center gap-1.5">
        <Briefcase className="h-4 w-4" /> {postingTypeLabel(posting.type)}
      </span>
      {posting.location ? (
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4" /> {posting.location}
        </span>
      ) : null}
      {posting.compensation ? (
        <span className="inline-flex items-center gap-1.5">
          <Briefcase className="h-4 w-4" /> {posting.compensation}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <CalendarClock className="h-4 w-4" />
        {deadline ? `Apply by ${deadline}` : "No deadline"}
      </span>
    </div>
  );
}

function ApplyPanel({
  posting,
  onApply,
}: {
  posting: PostingDetail;
  onApply: () => void;
}) {
  const affordance = applyAffordance({
    applyUrl: posting.applyUrl,
    isOpen: posting.isOpen,
    myApplication: posting.myApplication,
  });

  switch (affordance) {
    case "external":
      return (
        <Button asChild size="lg" className="w-full">
          <a href={posting.applyUrl} target="_blank" rel="noopener noreferrer">
            Apply on company site <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      );
    case "apply":
      return (
        <Button size="lg" className="w-full" onClick={onApply}>
          Apply
        </Button>
      );
    case "status": {
      const app = posting.myApplication;
      if (!app) return null;
      return (
        <div className="space-y-2 text-center">
          <p className="text-sm text-ink-muted">Your application</p>
          <Badge variant={statusBadgeVariant(app.status)}>
            {statusLabel(app.status)}
          </Badge>
        </div>
      );
    }
    case "closed":
    default:
      return (
        <Button size="lg" className="w-full" disabled>
          Applications closed
        </Button>
      );
  }
}

export function PostingDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  // `?c=<slug>` seam: a college posting resolves + applies through the tenant
  // endpoints; without it, the shared individual detail/apply flow is used. The
  // reused UI below is identical either way.
  const collegeSlug = searchParams.get("c") || null;
  // Back-nav returns to the college student space when opened from there.
  const careersHome = collegeSlug
    ? `/c/${encodeURIComponent(collegeSlug)}/placements`
    : "/careers";
  const { profile, user } = useAuth();
  const [applyOpen, setApplyOpen] = useState(false);

  const { data, loading, error, refetch } = useQuery<PostingDetail>(
    () =>
      collegeSlug
        ? api.collegeCareers.studentGet(collegeSlug, id)
        : api.careers.get(id),
    [id, collegeSlug],
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          to={careersHome}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to careers
        </Link>
        <Alert variant="error">
          {error ?? "This posting could not be loaded."}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to={careersHome}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to careers
      </Link>

      <PageHeader
        title={data.title}
        description={data.company}
        actions={
          data.isOpen ? (
            <Badge variant="success">Open</Badge>
          ) : (
            <Badge variant="error">Closed</Badge>
          )
        }
      />

      <MetaRow posting={data} />

      <Card>
        <CardContent className="p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
            <div className="min-w-0 space-y-8">
              {data.description ? (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-ink">
                    About the role
                  </h2>
                  <Markdown content={data.description} />
                </section>
              ) : null}
              {data.requirements ? (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-ink">
                    Requirements
                  </h2>
                  <Markdown content={data.requirements} />
                </section>
              ) : null}
            </div>

            <aside className="lg:border-l lg:border-subtle lg:pl-8">
              <div className="rounded-xl border border-subtle bg-surface-base p-4">
                <ApplyPanel posting={data} onApply={() => setApplyOpen(true)} />
              </div>
            </aside>
          </div>
        </CardContent>
      </Card>

      <ApplyDialog
        postingId={data.id}
        postingTitle={data.title}
        collegeSlug={collegeSlug ?? undefined}
        open={applyOpen}
        onOpenChange={setApplyOpen}
        defaults={{
          fullName: profile?.fullName ?? "",
          email: user?.email ?? "",
          phone: profile?.phoneNumber ?? "",
        }}
        onResolved={refetch}
      />
    </div>
  );
}
