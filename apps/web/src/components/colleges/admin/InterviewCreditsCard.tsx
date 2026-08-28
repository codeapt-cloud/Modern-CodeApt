/**
 * Super-admin "Mock-interview credits" card (Step 38) for a college in
 * CollegeManagePage. A one-time settable TOTAL: 1 credit = 1 interview started.
 * The super-admin controls the total number of interviews a college may run; it
 * depletes as students take interviews and is topped up by raising this number.
 * Separate from the monthly AI budget (CreditsCard). College_admins see a
 * read-only granted/used/remaining readout on their dashboard.
 */
import type { College } from "@codeapt/shared";
import { Ticket } from "lucide-react";
import { useEffect, useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import { useQuery } from "../../../lib/use-query.js";
import { Button } from "../../ui/button.js";
import { Card } from "../../ui/card.js";
import { FormField } from "../../ui/form-field.js";
import { Input } from "../../ui/input.js";
import { Skeleton } from "../../ui/skeleton.js";
import { useToast } from "../../ui/toast.js";

export function InterviewCreditsCard({ collegeId }: { collegeId: string }) {
  const { toast } = useToast();
  const query = useQuery(() => api.adminColleges.get(collegeId), [collegeId]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const college: College | null = query.data ?? null;
  const granted = college?.credits.interviewCredits ?? 0;

  useEffect(() => {
    if (college) setValue(String(college.credits.interviewCredits ?? 0));
  }, [college]);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const interviewCredits = Math.max(0, Math.trunc(Number(value.trim()) || 0));
      await api.adminColleges.setCredits(collegeId, { interviewCredits });
      await query.refetch();
      toast({ variant: "success", title: "Interview credits saved" });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Ticket className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-ink">Mock-interview credits</h2>
      </div>
      <p className="mb-5 text-sm text-ink-muted">
        The total number of mock interviews this college may run —{" "}
        <span className="font-mono">1 credit = 1 interview</span>. It depletes as
        students take interviews; raise it to grant more. The college&apos;s admins
        see the remaining balance on their dashboard.
      </p>

      {query.loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : query.error || !college ? (
        <p className="text-sm text-error-fg">{query.error ?? "Couldn't load the college."}</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-subtle bg-surface-base px-3 py-2">
            <div className="text-xs text-ink-muted">Current total granted</div>
            <div className="font-mono text-lg font-semibold text-ink">{granted}</div>
          </div>
          <div className="flex items-end gap-3">
            <FormField label="Interview credits (total)" hint="1 credit = 1 interview.">
              <Input
                type="number"
                min={0}
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value)}
              />
            </FormField>
            <Button disabled={busy} loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
