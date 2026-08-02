/**
 * Applicants for one college posting (Dialog) — the tenant-scoped operator view
 * (Phase 5b). Lists each applicant's contact + resume/cover letter and lets a
 * college_admin/faculty move their status through the enum. Reads/writes the
 * tenant `collegeCareers` endpoints (server enforces the posting is one the
 * actor may manage). Basic by design — rich cohort analytics live in Phase 5a.
 */
import {
  JOB_APPLICATION_STATUS_VALUES,
  type AdminApplicationRow,
  type JobApplicationStatus,
} from "@codeapt/shared";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { statusLabel } from "../../../lib/careers-ui.js";
import { useQuery } from "../../../lib/use-query.js";
import { Alert } from "../../ui/alert.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { EmptyState } from "../../ui/empty-state.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { Skeleton } from "../../ui/skeleton.js";
import { useToast } from "../../ui/toast.js";

export interface CollegeApplicationsDialogProps {
  slug: string;
  postingId: string;
  postingTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ApplicantRow({
  slug,
  row,
}: {
  slug: string;
  row: AdminApplicationRow;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<JobApplicationStatus>(row.status);
  const [saving, setSaving] = useState(false);

  const change = async (next: JobApplicationStatus): Promise<void> => {
    const prev = status;
    setStatus(next);
    setSaving(true);
    try {
      await api.collegeCareers.updateApplicationStatus(slug, row.id, next);
      toast({ variant: "success", title: `Marked ${statusLabel(next)}` });
    } catch (err) {
      setStatus(prev);
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-ink">{row.fullName}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3.5 w-3.5" /> {row.email}
          </span>
          {row.phone ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" /> {row.phone}
            </span>
          ) : null}
          {row.resumeUrl ? (
            <a
              href={row.resumeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Resume
            </a>
          ) : null}
        </div>
        {row.coverLetter ? (
          <p className="line-clamp-2 text-xs text-ink-muted">
            {row.coverLetter}
          </p>
        ) : null}
      </div>
      <div className="w-full sm:w-44">
        <Select
          value={status}
          onValueChange={(v) => void change(v as JobApplicationStatus)}
          disabled={saving}
        >
          <SelectTrigger aria-label="Application status">
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
      </div>
    </div>
  );
}

export function CollegeApplicationsDialog({
  slug,
  postingId,
  postingTitle,
  open,
  onOpenChange,
}: CollegeApplicationsDialogProps) {
  const query = useQuery(
    () =>
      open
        ? api.collegeCareers.applications(slug, postingId)
        : Promise.resolve({ postingId, postingTitle, items: [] }),
    [slug, postingId, open],
  );
  const items = query.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Applicants — {postingTitle}</DialogTitle>
          <DialogDescription>
            {items.length} application{items.length === 1 ? "" : "s"}. Update a
            status to move an applicant through your pipeline.
          </DialogDescription>
        </DialogHeader>

        {query.loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : query.error ? (
          <Alert variant="error">{query.error}</Alert>
        ) : items.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="Applicants appear here once students apply to this posting."
          />
        ) : (
          <div className="space-y-3">
            {items.map((row) => (
              <ApplicantRow key={row.id} slug={slug} row={row} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
