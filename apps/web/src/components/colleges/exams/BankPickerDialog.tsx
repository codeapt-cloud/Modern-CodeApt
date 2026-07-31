/**
 * Bank picker for the college exam editor. One dialog reused for all three
 * sources (Standard / Coding / Self), parameterized by `source`. Browses the
 * backend (GET /c/:slug/question-banks, scope+kind from the source, filters +
 * search + pagination), and ADDS selected questions into the current exam
 * section via pull-into-exam (POST /c/:slug/question-banks/pull-into-exam) —
 * copied as real ExamQuestions server-side. Per-question "Add" flips to "Added",
 * plus multi-select "Add selected". Standard/Coding read the GRANTED global
 * banks; Self reads the college's own. The bank backend is unchanged.
 */
import type { BankQuestion } from "@codeapt/shared";
import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import {
  buildBankBrowseQuery,
  emptyBankFacets,
  emptyBankFilters,
  pageCount,
  toggleId,
  type BankFilterState,
  type BankSource,
} from "../../../lib/question-bank-ui.js";
import { useQuery } from "../../../lib/use-query.js";
import { BankFilterBar } from "../../question-banks/BankFilterBar.js";
import { BankResultRow } from "../../question-banks/BankResultRow.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { EmptyState } from "../../ui/empty-state.js";
import { Pagination } from "../../ui/pagination.js";
import { Skeleton } from "../../ui/skeleton.js";
import { useToast } from "../../ui/toast.js";

const SOURCE_TITLE: Record<BankSource, string> = {
  standard: "Standard Bank",
  coding: "Coding Bank",
  self: "Self Bank",
};
const SOURCE_DESC: Record<BankSource, string> = {
  standard: "Curated MCQ questions from the global Standard bank.",
  coding: "Curated coding questions from the global Coding bank.",
  self: "Questions from your college's own bank (auto-collected from your uploads).",
};

const PAGE_SIZE = 20;

export function BankPickerDialog({
  open,
  onOpenChange,
  slug,
  source,
  examId,
  sectionId,
  sectionName,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  source: BankSource;
  examId: string;
  sectionId: string;
  sectionName: string;
  /** Refetch the exam tree after questions are pulled in. */
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<BankFilterState>(emptyBankFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () => buildBankBrowseQuery(source, filters, page, PAGE_SIZE),
    [source, filters, page],
  );
  const listQuery = useQuery(
    () => api.collegeQuestionBanks.browse(slug, query),
    [slug, JSON.stringify(query)],
  );

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const total = listQuery.data?.total ?? 0;
  const facets = listQuery.data?.facets ?? emptyBankFacets();

  const patchFilters = (patch: Partial<BankFilterState>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const pull = async (ids: string[]): Promise<void> => {
    const fresh = ids.filter((id) => !added.has(id));
    if (fresh.length === 0) return;
    setBusy(true);
    try {
      const res = await api.collegeQuestionBanks.pullIntoExam(slug, {
        examId,
        sectionId,
        questionIds: fresh,
      });
      setAdded((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.add(id));
        return next;
      });
      setSelected((prev) => prev.filter((id) => !fresh.includes(id)));
      toast({
        variant: "success",
        title: `Added ${res.pulled} question${res.pulled === 1 ? "" : "s"}${
          res.skipped > 0 ? ` (${res.skipped} skipped)` : ""
        }`,
      });
      onAdded();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const addButton = (q: BankQuestion): React.ReactNode => {
    if (added.has(q.id)) {
      return (
        <Button size="sm" variant="secondary" disabled>
          <Check className="h-4 w-4" /> Added
        </Button>
      );
    }
    return (
      <Button size="sm" disabled={busy} onClick={() => void pull([q.id])}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    );
  };

  const selectableSelected = selected.filter((id) => !added.has(id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{SOURCE_TITLE[source]}</DialogTitle>
          <DialogDescription>
            {SOURCE_DESC[source]} Adding into section{" "}
            <span className="text-ink">{sectionName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <BankFilterBar
            filters={filters}
            facets={facets}
            onChange={patchFilters}
          />

          <p className="text-xs text-ink-muted">
            {listQuery.loading
              ? "Loading…"
              : `${total} question${total === 1 ? "" : "s"} found`}
          </p>

          {listQuery.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : listQuery.error ? (
            <Alert variant="error">{listQuery.error}</Alert>
          ) : items.length === 0 ? (
            <EmptyState
              title="No questions found"
              description="Try clearing a filter or search term."
              icon={<Plus />}
            />
          ) : (
            <>
              <ul className="divide-y divide-subtle rounded-xl border border-subtle">
                {items.map((q) => (
                  <BankResultRow
                    key={q.id}
                    question={q}
                    selectable={!added.has(q.id)}
                    selected={selected.includes(q.id)}
                    onToggleSelect={() =>
                      setSelected((prev) => toggleId(prev, q.id))
                    }
                    trailing={addButton(q)}
                  />
                ))}
              </ul>
              {pageCount(total, PAGE_SIZE) > 1 ? (
                <div className="flex justify-center">
                  <Pagination
                    page={page}
                    totalPages={pageCount(total, PAGE_SIZE)}
                    onPageChange={setPage}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="items-center justify-between">
          <span className="text-sm text-ink-muted">
            {selectableSelected.length > 0
              ? `${selectableSelected.length} selected`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button
              loading={busy}
              disabled={selectableSelected.length === 0}
              onClick={() => void pull(selectableSelected)}
            >
              <Plus className="h-4 w-4" /> Add selected
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
