/**
 * Placements (student space, route: /c/:slug/placements). Lists this student's
 * published, in-target college postings (GET /c/:slug/careers student list) and
 * links each to the EXISTING posting detail + apply flow at /careers/:id?c=<slug>
 * (the reused apply dialog + "already applied" state are untouched; the `?c` seam
 * scopes detail/apply and returns back-nav to this space). Gated on `postings`.
 */
import { CollegeFeature, checkEntitlement, type PostingSummary } from "@codeapt/shared";
import { Briefcase, MapPin } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Stagger, StaggerItem } from "../../components/motion/index.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { postingTypeLabel } from "../../lib/careers-ui.js";
import { imageUrl } from "../../lib/cloudinary.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

function CompanyLogo({ name, src }: { name: string; src: string }) {
  if (src) {
    return (
      <img
        src={imageUrl(src)}
        alt=""
        className="h-11 w-11 rounded-lg border border-subtle object-cover"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 font-mono text-lg font-semibold text-primary"
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function PlacementCard({ posting, slug }: { posting: PostingSummary; slug: string }) {
  const deadline = posting.deadline
    ? new Date(posting.deadline).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <Link
      to={`/careers/${posting.id}?c=${encodeURIComponent(slug)}`}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
    >
      <Card className="flex h-full flex-col transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
        <CardContent className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <CompanyLogo name={posting.company} src={posting.companyLogo} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-ink">{posting.title}</h3>
              <p className="truncate text-sm text-ink-muted">{posting.company}</p>
            </div>
            <Badge variant="outline">{postingTypeLabel(posting.type)}</Badge>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            {posting.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {posting.location}
              </span>
            ) : null}
            {posting.compensation ? (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" /> {posting.compensation}
              </span>
            ) : null}
          </div>

          <div className="mt-auto text-xs font-medium">
            {!posting.isOpen ? (
              <span className="text-error-fg">Closed</span>
            ) : deadline ? (
              <span className="text-ink-muted">Apply by {deadline}</span>
            ) : (
              <span className="text-success-fg">Open</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function CollegeStudentPlacementsPage() {
  const { slug, context } = useCollege();
  const enabled = checkEntitlement(context.entitlements, CollegeFeature.POSTINGS);

  const query = useQuery(
    () => (enabled ? api.collegeCareers.studentList(slug) : Promise.resolve({ items: [] })),
    [slug, enabled],
  );
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Placements"
        description="Jobs and internships your college has opened to your cohort."
      />

      {!enabled ? (
        <Alert variant="info">
          Placements aren&apos;t enabled for your college yet.
        </Alert>
      ) : query.loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-11 w-11 rounded-lg" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : query.error ? (
        <Alert variant="error">{query.error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No open placements"
          description="Openings your college posts for your cohort will appear here."
          icon={<Briefcase />}
        />
      ) : (
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <StaggerItem key={p.id} className="h-full">
              <PlacementCard posting={p} slug={slug} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
