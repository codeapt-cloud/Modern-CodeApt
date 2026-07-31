/**
 * My applications (route: /careers/applications). The student's own in-app
 * applications, newest first — posting summary + status badge + applied date,
 * each linking back to the posting. The server returns only the caller's
 * applications (no other applicant's data).
 */
import type { MyApplication } from "@codeapt/shared";
import { Briefcase } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import {
  postingTypeLabel,
  statusBadgeVariant,
  statusLabel,
} from "../../lib/careers-ui.js";
import { useQuery } from "../../lib/use-query.js";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ApplicationRow({ application }: { application: MyApplication }) {
  const { posting } = application;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              to={`/careers/${posting.id}`}
              className="truncate font-medium text-ink hover:text-primary"
            >
              {posting.title}
            </Link>
            <Badge variant={statusBadgeVariant(application.status)}>
              {statusLabel(application.status)}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {posting.company} · {postingTypeLabel(posting.type)} · applied{" "}
            {fmtDate(application.appliedAt)}
          </p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link to={`/careers/${posting.id}`}>View posting</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function MyApplicationsPage() {
  const { data, loading, error } = useQuery(
    () => api.careers.myApplications(),
    [],
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My applications"
        description="Roles you've applied to in-app and where each one stands."
      />
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="When you apply to a posting in-app, it will show up here."
          icon={<Briefcase />}
          action={
            <Button asChild size="sm">
              <Link to="/careers">Browse openings</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <ApplicationRow key={a.id} application={a} />
          ))}
        </div>
      )}
    </div>
  );
}
