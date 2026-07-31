/**
 * Careers listing (route: /careers). Paginated posting cards with a type
 * filter + debounced search hitting the server's `q`. The server owns the
 * open/closed gate; we render `isOpen` and the deadline as-is.
 */
import {
  POSTING_TYPE_VALUES,
  type PostingType,
} from "@codeapt/shared";
import { Briefcase, MapPin, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "../../components/layout/PageHeader.js";
import { Stagger, StaggerItem } from "../../components/motion/index.js";
import { Alert } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Input } from "../../components/ui/input.js";
import { Pagination } from "../../components/ui/pagination.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { api } from "../../lib/api-client.js";
import { postingTypeLabel } from "../../lib/careers-ui.js";
import { imageUrl } from "../../lib/cloudinary.js";
import {
  mergeStudentPostings,
  type StudentPostingItem,
} from "../../lib/student-postings.js";
import { useQuery } from "../../lib/use-query.js";

const ALL = "all";

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

function DeadlineNote({ posting }: { posting: StudentPostingItem }) {
  if (!posting.isOpen) {
    return <span className="text-error-fg">Closed</span>;
  }
  if (!posting.deadline) return <span className="text-success-fg">Open</span>;
  const date = new Date(posting.deadline).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return <span className="text-ink-muted">Apply by {date}</span>;
}

function PostingCard({ posting }: { posting: StudentPostingItem }) {
  // College postings carry a `?c=<slug>` seam so the detail + apply flow hits
  // the tenant endpoints; individual postings link to the shared detail.
  const to =
    posting.source === "college" && posting.collegeSlug
      ? `/careers/${posting.id}?c=${posting.collegeSlug}`
      : `/careers/${posting.id}`;
  return (
    <Link
      to={to}
      className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:shadow-focus"
    >
      <Card className="flex h-full flex-col transition-all duration-base group-hover:-translate-y-0.5 group-hover:shadow-glow">
        <CardContent className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <CompanyLogo name={posting.company} src={posting.companyLogo} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold text-ink">
                {posting.title}
              </h3>
              <p className="truncate text-sm text-ink-muted">
                {posting.company}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline">{postingTypeLabel(posting.type)}</Badge>
              {posting.source === "college" ? (
                <Badge variant="info">Your college</Badge>
              ) : null}
            </div>
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
            <DeadlineNote posting={posting} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function CareersPage() {
  const [rawQ, setRawQ] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  // Debounce the search box → `q`, resetting to page 1 on a new term.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(rawQ.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [rawQ]);

  const params = useMemo(
    () => ({
      page,
      q: q || undefined,
      type: type === ALL ? undefined : (type as PostingType),
    }),
    [page, q, type],
  );

  const {
    data,
    loading: individualLoading,
    error,
  } = useQuery(() => api.careers.list(params), [params]);

  // A college student also sees their published, in-target college postings —
  // prepended on page 1. Tolerate the college call failing (e.g. the `postings`
  // feature is off) by degrading to none, so the global feed still renders.
  const collegeQuery = useQuery(async () => {
    const { college } = await api.me.college();
    if (!college) return { slug: null, items: [] };
    try {
      const res = await api.collegeCareers.studentList(college.slug);
      return { slug: college.slug, items: res.items };
    } catch {
      return { slug: college.slug, items: [] };
    }
  }, []);

  // College postings are prepended only on page 1, and mirror the active type +
  // search filters client-side so the controls behave consistently.
  const collegeItems = useMemo(() => {
    if (page !== 1) return [];
    const all = collegeQuery.data?.items ?? [];
    const needle = q.toLowerCase();
    return all.filter((p) => {
      if (type !== ALL && p.type !== type) return false;
      if (needle) {
        return (
          p.title.toLowerCase().includes(needle) ||
          p.company.toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [page, q, type, collegeQuery.data]);

  const items = mergeStudentPostings(
    data?.items ?? [],
    collegeItems,
    collegeQuery.data?.slug ?? null,
  );
  const loading = individualLoading || collegeQuery.loading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Careers"
        description="Job & internship openings and campus placement drives."
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full max-w-sm">
          <Input
            leading={<Search />}
            placeholder="Search roles or companies…"
            value={rawQ}
            onChange={(e) => setRawQ(e.target.value)}
            aria-label="Search postings"
          />
        </div>
        <div className="w-48">
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {POSTING_TYPE_VALUES.map((t) => (
                <SelectItem key={t} value={t}>
                  {postingTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <Alert variant="error">{error}</Alert>
      ) : loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-11 w-11 rounded-lg" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No openings found"
          description="Try a different search or clear the type filter."
          icon={<Briefcase />}
        />
      ) : (
        <>
          <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <StaggerItem key={`${p.source}:${p.id}`} className="h-full">
                <PostingCard posting={p} />
              </StaggerItem>
            ))}
          </Stagger>
          {data && data.totalPages > 1 ? (
            <div className="flex justify-center pt-2">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                onPageChange={setPage}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
