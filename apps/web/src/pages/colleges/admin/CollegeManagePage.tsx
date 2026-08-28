/**
 * College manage / control panel (route: /admin/colleges/:collegeId). The heart
 * of "max admin control": for one college, toggle any of the catalog FEATURES,
 * toggle each feature's SUB-CAPABILITIES (nested, greyed when the feature is
 * off), and grant/revoke specific master-catalog COURSES — every change persists
 * via the Phase 0 API and reflects the returned entitlements. Feature/sub-cap
 * rows are driven by the SHARED catalog (buildEntitlementTree), never a hardcoded
 * list. Also edits basics + suspends/reactivates.
 */
import { CollegeStatus, type College } from "@codeapt/shared";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  ExternalLink,
  Pencil,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { CollegeAdminDialog } from "../../../components/colleges/admin/CollegeAdminDialog.js";
import { CollegeEditorDialog } from "../../../components/colleges/admin/CollegeEditorDialog.js";
import { CreditsCard } from "../../../components/colleges/admin/CreditsCard.js";
import { InterviewCreditsCard } from "../../../components/colleges/admin/InterviewCreditsCard.js";
import { LoginBrandingCard } from "../../../components/colleges/admin/LoginBrandingCard.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { Switch } from "../../../components/ui/switch.js";
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import {
  buildEntitlementTree,
  enabledFeatureCount,
  TOTAL_FEATURE_COUNT,
} from "../../../lib/entitlements-ui.js";
import { useQuery } from "../../../lib/use-query.js";
import type { SetEntitlementsInput } from "@codeapt/shared";

export function CollegeManagePage() {
  const { collegeId = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data, loading, error } = useQuery(
    () => api.adminColleges.get(collegeId),
    [collegeId],
  );
  const adminsQuery = useQuery(
    () => api.adminColleges.listAdmins(collegeId),
    [collegeId],
  );
  const [adminOpen, setAdminOpen] = useState(false);
  const { data: subjectsData } = useQuery(
    () => api.adminCurriculum.subjects.list(),
    [],
  );
  const subjects = subjectsData?.items ?? [];

  const [college, setCollege] = useState<College | null>(null);
  useEffect(() => {
    if (data) setCollege(data);
  }, [data]);

  // A single in-flight flag: while any mutation runs, all toggles are disabled
  // so concurrent writes can't race the "server response is truth" state.
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [courseFilter, setCourseFilter] = useState("");

  async function mutate(
    run: () => Promise<College>,
    okTitle?: string,
  ): Promise<void> {
    setBusy(true);
    try {
      const updated = await run();
      setCollege(updated);
      if (okTitle) toast({ variant: "success", title: okTitle });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  }

  const applyEntitlements = (body: SetEntitlementsInput): Promise<void> =>
    mutate(() => api.adminColleges.setEntitlements(collegeId, body));

  if (loading && !college) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }
  if (error) return <Alert variant="error">{error}</Alert>;
  if (!college) return null;

  const active = college.status === CollegeStatus.ACTIVE;
  const tree = buildEntitlementTree(college.entitlements);
  const grantedSet = new Set(college.entitlements.grantedCourses);
  const visibleSubjects = subjects.filter((s) => {
    const q = courseFilter.trim().toLowerCase();
    return (
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <Link
        to="/admin/colleges"
        className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> All colleges
      </Link>

      <PageHeader
        breadcrumbs={[
          { label: "Colleges", href: "/admin/colleges" },
          { label: college.name },
        ]}
        title={college.name}
        description={
          <span className="font-mono text-xs">/c/{college.slug}</span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => navigate(`/c/${college.slug}/structure`)}
            >
              <ExternalLink className="h-4 w-4" /> Open workspace
            </Button>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit basics
            </Button>
            {active ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      api.adminColleges.update(collegeId, {
                        status: CollegeStatus.SUSPENDED,
                      }),
                    "College suspended",
                  )
                }
              >
                Suspend
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      api.adminColleges.update(collegeId, {
                        status: CollegeStatus.ACTIVE,
                      }),
                    "College reactivated",
                  )
                }
              >
                Reactivate
              </Button>
            )}
          </>
        }
      />

      {/* Overview */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
        <span className="inline-flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4 text-ink-muted" />
          {active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="warning">Suspended</Badge>
          )}
        </span>
        <span className="text-sm text-ink-secondary">
          <span className="text-ink-muted">Features:</span>{" "}
          {enabledFeatureCount(college.entitlements)} / {TOTAL_FEATURE_COUNT}
        </span>
        <span className="text-sm text-ink-secondary">
          <span className="text-ink-muted">Granted courses:</span>{" "}
          {college.entitlements.grantedCourses.length}
        </span>
        {college.contactEmail ? (
          <span className="text-sm text-ink-secondary">
            <span className="text-ink-muted">Contact:</span>{" "}
            {college.contactEmail}
          </span>
        ) : null}
      </Card>

      {/* Features + sub-capabilities */}
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-ink">
            Features & capabilities
          </h2>
        </div>
        <p className="mb-5 text-sm text-ink-muted">
          Turn features on or off for this college. Sub-capabilities require
          their parent feature to be enabled.
        </p>

        <div className="space-y-3">
          {tree.map((f) => (
            <div
              key={f.key}
              className="rounded-xl border border-subtle bg-surface-base/50 p-4"
            >
              <label className="flex items-center justify-between gap-4">
                <span className="font-medium text-ink">{f.label}</span>
                <Switch
                  checked={f.enabled}
                  disabled={busy}
                  onCheckedChange={(v) =>
                    void applyEntitlements({ features: { [f.key]: v } })
                  }
                  aria-label={`Toggle ${f.label}`}
                />
              </label>

              {f.subCapabilities.length > 0 ? (
                <div className="mt-3 space-y-2 border-l-2 border-subtle pl-4">
                  {f.subCapabilities.map((sc) => (
                    <label
                      key={sc.key}
                      className={
                        "flex items-center justify-between gap-4 " +
                        (sc.disabled ? "opacity-50" : "")
                      }
                    >
                      <span className="text-sm text-ink-secondary">
                        {sc.label}
                        <span className="ml-2 font-mono text-[11px] text-ink-muted">
                          {sc.key}
                        </span>
                      </span>
                      <Switch
                        checked={sc.enabled}
                        disabled={busy || sc.disabled}
                        onCheckedChange={(v) =>
                          void applyEntitlements({
                            subCapabilities: { [sc.key]: v },
                          })
                        }
                        aria-label={`Toggle ${sc.key}`}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* AI credits (Stage 1) — per-college monthly AI budget */}
      <CreditsCard collegeId={collegeId} />

      {/* Mock-interview credits (Step 38) — one-time settable total, 1 = 1 interview */}
      <InterviewCreditsCard collegeId={collegeId} />

      {/* Login branding — public skin of /c/:slug/login */}
      <LoginBrandingCard
        collegeName={college.name}
        slug={college.slug}
        branding={college.branding}
        busy={busy}
        onSave={(branding) =>
          mutate(
            () => api.adminColleges.update(collegeId, { branding }),
            "Login branding saved",
          )
        }
      />

      {/* Courses */}
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-ink">Granted courses</h2>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          Grant specific master-catalog courses to this college. Only granted
          courses are available to its users.
        </p>

        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            className="pl-9"
            placeholder="Filter courses…"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
          />
        </div>

        {subjects.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No courses in the master catalog yet.
          </p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {visibleSubjects.map((s) => {
              const granted = grantedSet.has(s.id);
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-subtle bg-surface-base/50 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {s.name}
                    </p>
                    <p className="truncate font-mono text-[11px] text-ink-muted">
                      {s.slug}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {granted ? (
                      <Badge variant="success">Granted</Badge>
                    ) : null}
                    <Switch
                      checked={granted}
                      disabled={busy}
                      aria-label={`Grant ${s.name}`}
                      onCheckedChange={(v) =>
                        void mutate(
                          () =>
                            v
                              ? api.adminColleges.grantCourses(collegeId, {
                                  courseIds: [s.id],
                                })
                              : api.adminColleges.revokeCourses(collegeId, {
                                  courseIds: [s.id],
                                }),
                        )
                      }
                    />
                  </div>
                </div>
              );
            })}
            {visibleSubjects.length === 0 ? (
              <p className="text-sm text-ink-muted">No courses match.</p>
            ) : null}
          </div>
        )}
      </Card>

      {/* College admins */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-ink">College admins</h2>
          </div>
          <Button size="sm" onClick={() => setAdminOpen(true)}>
            <UserPlus className="h-4 w-4" /> Add college admin
          </Button>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          Administrators who run this college&apos;s workspace. They sign in and
          get a &ldquo;My college&rdquo; entry to <span className="font-mono">/c/{college.slug}</span>.
        </p>

        {adminsQuery.loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (adminsQuery.data?.items.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-subtle bg-surface-base/50 px-4 py-3 text-sm text-ink-muted">
            No college admins yet. Add one so they can manage this college.
          </p>
        ) : (
          <div className="space-y-2">
            {adminsQuery.data?.items.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-subtle bg-surface-base/50 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {a.fullName || a.username}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {a.email} · @{a.username}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.forcePasswordChange ? (
                    <Badge variant="warning">Pending first login</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editOpen ? (
        <CollegeEditorDialog
          open
          onOpenChange={setEditOpen}
          initial={college}
          onSaved={(saved) => setCollege(saved)}
        />
      ) : null}

      {adminOpen ? (
        <CollegeAdminDialog
          open
          onOpenChange={setAdminOpen}
          collegeId={collegeId}
          onSaved={() => adminsQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
