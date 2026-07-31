import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../../lib/cn.js";
import { IconButton } from "./icon-button.js";

/** Build a compact page list with ellipses (e.g. 1 … 4 5 6 … 20). */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center gap-1", className)}
    >
      <IconButton
        aria-label="Previous page"
        variant="ghost"
        size="sm"
        icon={<ChevronLeft className="h-4 w-4" />}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      />
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-2 text-sm text-ink-muted">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            className={cn(
              "h-8 min-w-8 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-focus",
              p === page
                ? "bg-primary text-ink-inverse"
                : "text-ink-secondary hover:bg-surface-overlay",
            )}
          >
            {p}
          </button>
        ),
      )}
      <IconButton
        aria-label="Next page"
        variant="ghost"
        size="sm"
        icon={<ChevronRight className="h-4 w-4" />}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      />
    </nav>
  );
}
