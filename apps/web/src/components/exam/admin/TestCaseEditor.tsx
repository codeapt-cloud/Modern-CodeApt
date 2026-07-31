/**
 * Test-case sub-editor for a CODE question. Lists existing cases (visible vs
 * hidden) and adds/deletes them via the real admin endpoints. `is_hidden` is
 * clearly labeled: hidden cases are used for scoring but never shown in the
 * candidate's "Run Tests" panel.
 */
import type { AdminExamDetail } from "@codeapt/shared";
import { EyeOff, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, parseApiError } from "../../../lib/api-client.js";
import type { ExamAuthoringApi } from "../../../lib/exam-authoring-api.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { FormField } from "../../ui/form-field.js";
import { IconButton } from "../../ui/icon-button.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import { useToast } from "../../ui/toast.js";

type TestCase = AdminExamDetail["sections"][number]["questions"][number]["testCases"][number];

export function TestCaseEditor({
  questionId,
  testCases,
  onChanged,
  onRequestDelete,
  authApi = api.adminExams,
}: {
  questionId: string;
  testCases: TestCase[];
  onChanged: () => void;
  /** Route deletion through the page-level confirm dialog. */
  onRequestDelete: (testCaseId: string) => void;
  /** Authoring backend — defaults to the platform admin api; the college editor
   * injects a slug-bound tenant adapter. */
  authApi?: ExamAuthoringApi;
}) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [isHidden, setIsHidden] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resetForm = (): void => {
    setInput("");
    setExpectedOutput("");
    setIsHidden(false);
    setEditingId(null);
  };

  const startEdit = (tc: TestCase): void => {
    setEditingId(tc.id);
    setInput(tc.input);
    setExpectedOutput(tc.expectedOutput);
    setIsHidden(tc.isHidden);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (editingId) {
        await authApi.updateTestCase(editingId, {
          input,
          expectedOutput,
          isHidden,
          order: testCases.length,
        });
        toast({ variant: "success", title: "Test case updated" });
      } else {
        await authApi.addTestCase(questionId, {
          input,
          expectedOutput,
          isHidden,
          order: testCases.length,
        });
        toast({ variant: "success", title: "Test case added" });
      }
      resetForm();
      onChanged();
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-subtle bg-surface-base p-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Test cases
        </h5>
        <span className="text-xs text-ink-muted">
          {testCases.length} total
        </span>
      </div>

      {testCases.length > 0 ? (
        <ul className="space-y-2">
          {testCases.map((tc) => (
            <li
              key={tc.id}
              className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 rounded-lg border border-subtle bg-surface-raised p-2 text-sm"
            >
              <code className="truncate font-mono text-xs text-ink-secondary">
                in: {tc.input || "∅"}
              </code>
              <code className="truncate font-mono text-xs text-ink-secondary">
                out: {tc.expectedOutput || "∅"}
              </code>
              <div className="flex items-center gap-2">
                {tc.isHidden ? (
                  <Badge variant="neutral">
                    <EyeOff className="h-3 w-3" /> Hidden
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <Eye className="h-3 w-3" /> Visible
                  </Badge>
                )}
                <IconButton
                  aria-label="Edit test case"
                  variant="ghost"
                  size="sm"
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => startEdit(tc)}
                />
                <IconButton
                  aria-label="Delete test case"
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="h-4 w-4 text-error-fg" />}
                  onClick={() => onRequestDelete(tc.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">
          No test cases yet. Add at least one to score this question.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Input (stdin)">
          <Textarea
            rows={2}
            className="font-mono text-xs"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </FormField>
        <FormField label="Expected output">
          <Textarea
            rows={2}
            className="font-mono text-xs"
            value={expectedOutput}
            onChange={(e) => setExpectedOutput(e.target.value)}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2">
          <Switch checked={isHidden} onCheckedChange={setIsHidden} />
          <span className="text-sm text-ink">
            Hidden{" "}
            <span className="text-ink-muted">
              — used for scoring, not shown in Run Tests
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          {editingId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetForm}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => void save()}
          >
            {editingId ? (
              <>
                <Pencil className="h-4 w-4" /> Save changes
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Add test case
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
