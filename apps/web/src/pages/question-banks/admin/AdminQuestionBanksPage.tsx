/**
 * Super-admin GLOBAL question-bank management (/admin/question-banks). Browse +
 * filter the curated Standard/Coding banks, create / edit / delete a global
 * question, and BULK IMPORT the categorized MCQ/coding files (the seed sets land
 * here). Reuses the shared BankFilterBar + BankResultRow + the exam draft helpers.
 * Wraps the Prompt-1 endpoints (/admin/question-banks/...) unchanged.
 */
import {
  type BankBrowseQuery,
  type BankKind,
  type BankQuestion,
} from "@codeapt/shared";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { BankImportDialog } from "../../../components/question-banks/admin/BankImportDialog.js";
import { BankQuestionEditorDialog } from "../../../components/question-banks/admin/BankQuestionEditorDialog.js";
import { BankFilterBar } from "../../../components/question-banks/BankFilterBar.js";
import { BankResultRow } from "../../../components/question-banks/BankResultRow.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { Alert } from "../../../components/ui/alert.js";
import { Button } from "../../../components/ui/button.js";
import { Card } from "../../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { EmptyState } from "../../../components/ui/empty-state.js";
import { IconButton } from "../../../components/ui/icon-button.js";
import { Pagination } from "../../../components/ui/pagination.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs.js";
import { useToast } from "../../../components/ui/toast.js";
import { api, parseApiError } from "../../../lib/api-client.js";
import {
  emptyBankFacets,
  emptyBankFilters,
  pageCount,
  type BankFilterState,
} from "../../../lib/question-bank-ui.js";
import { useQuery } from "../../../lib/use-query.js";

const PAGE_SIZE = 20;
type KindTab = "all" | BankKind;

export function AdminQuestionBanksPage() {
  const { toast } = useToast();
  const [kindTab, setKindTab] = useState<KindTab>("all");
  const [filters, setFilters] = useState<BankFilterState>(emptyBankFilters);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BankQuestion | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo<BankBrowseQuery>(() => {
    const q: BankBrowseQuery = { scope: "global", page, pageSize: PAGE_SIZE };
    if (kindTab !== "all") q.kind = kindTab;
    if (filters.q.trim()) q.q = filters.q.trim();
    if (filters.category) q.category = filters.category;
    if (filters.subCategory) q.subCategory = filters.subCategory;
    if (filters.company) q.company = filters.company;
    if (filters.difficulty) q.difficulty = filters.difficulty;
    if (filters.tag) q.tag = filters.tag;
    return q;
  }, [kindTab, filters, page]);

  const listQuery = useQuery(
    () => api.adminQuestionBanks.list(query),
    [JSON.stringify(query)],
  );
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const total = listQuery.data?.total ?? 0;
  const facets = listQuery.data?.facets ?? emptyBankFacets();

  const patchFilters = (patch: Partial<BankFilterState>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const performDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.adminQuestionBanks.remove(confirmDelete.id);
      toast({ title: "Question deleted" });
      setConfirmDelete(null);
      listQuery.refetch();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Question banks"
        description="Curate the global Standard (MCQ) and Coding banks. Colleges granted access can pull these into their exams."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp className="h-4 w-4" /> Import
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New question
            </Button>
          </div>
        }
      />

      <Tabs
        value={kindTab}
        onValueChange={(v) => {
          setKindTab(v as KindTab);
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="standard">Standard (MCQ)</TabsTrigger>
          <TabsTrigger value="coding">Coding</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="p-4">
        <BankFilterBar
          filters={filters}
          facets={facets}
          onChange={patchFilters}
        />
      </Card>

      <p className="text-xs text-ink-muted">
        {listQuery.loading ? "Loading…" : `${total} question${total === 1 ? "" : "s"}`}
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
          title="No questions yet"
          description="Import a categorized workbook or add a question to start building the bank."
          icon={<Plus />}
          action={
            <Button size="sm" onClick={() => setImporting(true)}>
              <FileUp className="h-4 w-4" /> Import questions
            </Button>
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-subtle">
              {items.map((q) => (
                <BankResultRow
                  key={q.id}
                  question={q}
                  trailing={
                    <div className="flex items-center gap-1">
                      <IconButton
                        aria-label="Edit question"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => setEditing(q)}
                      />
                      <IconButton
                        aria-label="Delete question"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                        onClick={() => setConfirmDelete(q)}
                      />
                    </div>
                  }
                />
              ))}
            </ul>
          </Card>
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

      {creating ? (
        <BankQuestionEditorDialog
          open
          onOpenChange={setCreating}
          onSaved={() => listQuery.refetch()}
        />
      ) : null}

      {editing ? (
        <BankQuestionEditorDialog
          key={editing.id}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          initial={editing}
          onSaved={() => listQuery.refetch()}
        />
      ) : null}

      {importing ? (
        <BankImportDialog
          open
          onOpenChange={setImporting}
          onImported={() => listQuery.refetch()}
        />
      ) : null}

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete question?</DialogTitle>
            <DialogDescription>
              This global bank question will be permanently deleted. Questions
              already pulled into exams are unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => void performDelete()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
