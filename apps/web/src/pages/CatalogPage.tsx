import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { CourseCard } from "../components/course/CourseCard.js";
import { PageHeader } from "../components/layout/PageHeader.js";
import { Stagger, StaggerItem } from "../components/motion/index.js";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { cn } from "../lib/cn.js";
import { api } from "../lib/api-client.js";
import { useQuery } from "../lib/use-query.js";

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-strong text-ink-secondary hover:text-ink",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function CatalogPage() {
  const [q, setQ] = useState("");
  const [program, setProgram] = useState<string>("all");
  const [popular, setPopular] = useState(false);
  const [free, setFree] = useState(false);

  const params = useMemo(
    () => ({
      q: q.trim() || undefined,
      program: program === "all" ? undefined : program,
      popular: popular || undefined,
      free: free || undefined,
    }),
    [q, program, popular, free],
  );

  const { data, loading, error } = useQuery(
    () => api.curriculum.catalog(params),
    [params],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Courses"
        description="Structured tracks to prepare for placements — aptitude, DSA, verbal, and more."
      />

      {/* Filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full max-w-sm">
          <Input
            leading={<Search />}
            placeholder="Search courses…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select value={program} onValueChange={setProgram}>
              <SelectTrigger>
                <SelectValue placeholder="All programs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All programs</SelectItem>
                {/* Radix forbids an empty SelectItem value; a migrated legacy
                    program can have a blank slug (unfilterable), so skip it. */}
                {(data?.programs ?? [])
                  .filter((p) => p.slug)
                  .map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <FilterChip active={popular} onClick={() => setPopular((v) => !v)}>
            Popular
          </FilterChip>
          <FilterChip active={free} onClick={() => setFree((v) => !v)}>
            Free
          </FilterChip>
        </div>
      </div>

      {/* Results */}
      {error ? (
        <Card className="p-6 text-sm text-error-fg">{error}</Card>
      ) : loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-32 w-full rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </Card>
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <StaggerItem key={item.id} className="h-full">
              <CourseCard item={item} />
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <EmptyState
          title="No courses found"
          description="Try clearing your filters or search terms."
          action={
            <Button
              size="sm"
              onClick={() => {
                setQ("");
                setProgram("all");
                setPopular(false);
                setFree(false);
              }}
            >
              Clear filters
            </Button>
          }
        />
      )}
    </div>
  );
}
