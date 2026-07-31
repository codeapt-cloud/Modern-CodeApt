/**
 * Admin application review (route: /admin/careers/:id/applications). A table of
 * applicants for one posting (name, contact, resume, cover letter, status,
 * applied date) with a per-row status dropdown that PATCHes the application.
 * Only in-app (no-applyUrl) postings have applications; external ones show the
 * empty state gracefully.
 */
import {
  JOB_APPLICATION_STATUS_VALUES,
  type AdminApplicationRow,
  type JobApplicationStatus,
} from "@codeapt/shared";
import { ArrowLeft, FileText, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Card } from "../../../components/ui/card.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import { statusLabel } from "../../../lib/careers-ui.js";
import { useQuery } from "../../../lib/use-query.js";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusSelect({
  row,
  onChanged,
}: {
  row: AdminApplicationRow;
  onChanged: (status: JobApplicationStatus) => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState<JobApplicationStatus>(row.status);
  const [saving, setSaving] = useState(false);

  const change = async (next: string): Promise<void> => {
    const status = next as JobApplicationStatus;
    const prev = value;
    setValue(status);
    setSaving(true);
    try {
      await api.adminCareers.updateApplicationStatus(row.id, status);
      toast({ variant: "success", title: `Marked ${statusLabel(status)}` });
      onChanged(status);
    } catch (err) {
      setValue(prev); // revert on failure
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select value={value} onValueChange={(v) => void change(v)} disabled={saving}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JOB_APPLICATION_STATUS_VALUES.map((s) => (
          <SelectItem key={s} value={s}>
            {statusLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AdminApplicationsPage() {
  const { id = "" } = useParams();
  const { data, loading, error, refetch } = useQuery(
    () => api.adminCareers.applications(id),
    [id],
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <Link
        to="/admin/careers"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to postings
      </Link>

      <PageHeader
        title="Applications"
        description={data?.postingTitle ?? "Review applicants and set status."}
      />

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Applicants who apply in-app will appear here. External-apply postings collect applications on the company site."
          icon={<Users />}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicant</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Resume</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell>
                    <div className="font-medium text-ink">{row.fullName}</div>
                    {row.coverLetter ? (
                      <p className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-ink-muted">
                        {row.coverLetter}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-ink-secondary">
                    <div>{row.email}</div>
                    {row.phone ? (
                      <div className="text-xs text-ink-muted">{row.phone}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.resumeUrl ? (
                      <a
                        href={row.resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="h-4 w-4" /> Resume
                      </a>
                    ) : (
                      <Badge variant="neutral">None</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-ink-muted">
                    {fmtDate(row.appliedAt)}
                  </TableCell>
                  <TableCell>
                    <StatusSelect row={row} onChanged={() => refetch()} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
