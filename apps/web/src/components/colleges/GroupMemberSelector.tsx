/**
 * Reusable student-selection control — the de-duped UNION of org-units/sections,
 * individual students, and an Excel roll-number upload (matched/unmatched
 * preview, persists nothing). Shared by attendance group create/edit AND the
 * per-student AI credit allocation, so the "pick a set of students" UX is one
 * thing everywhere. Controlled: the parent owns the three selections.
 *
 * The Excel preview + template endpoints are PLUGGABLE (`previewFetcher` /
 * `templateFetcher`) so each surface uses its own feature-scoped route while the
 * matched/unmatched shape stays identical.
 */
import type { AttendanceImportPreviewResponse, CollegeStudent } from "@codeapt/shared";
import { Upload, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { api, parseApiError } from "../../lib/api-client.js";
import { flattenTree, orgUnitTypeLabel } from "../../lib/org-structure-ui.js";
import { useQuery } from "../../lib/use-query.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Skeleton } from "../ui/skeleton.js";
import { useToast } from "../ui/toast.js";

export interface ExcelPreview {
  matchedRolls: string[];
  matchedNames: string[];
  unmatched: string[];
}

/** Read a File into a bare base64 string (strips the data: URL prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export interface GroupMemberSelectorProps {
  slug: string;
  unitIds: Set<string>;
  onUnitIdsChange: (next: Set<string>) => void;
  studentIds: Set<string>;
  onStudentIdsChange: (next: Set<string>) => void;
  excel: ExcelPreview | null;
  onExcelChange: (next: ExcelPreview | null) => void;
  /** Feature-scoped Excel roll-number preview (defaults to attendance's). */
  previewFetcher?: (
    slug: string,
    fileBase64: string,
  ) => Promise<AttendanceImportPreviewResponse>;
  /** Feature-scoped template download (defaults to attendance's). */
  templateFetcher?: (slug: string) => Promise<{ blob: Blob; filename: string }>;
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function GroupMemberSelector({
  slug,
  unitIds,
  onUnitIdsChange,
  studentIds,
  onStudentIdsChange,
  excel,
  onExcelChange,
  previewFetcher = (s, f) => api.attendance.importPreview(s, f),
  templateFetcher = (s) => api.attendance.template(s),
}: GroupMemberSelectorProps) {
  const { toast } = useToast();
  const treeQuery = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const studentsQuery = useQuery(() => api.collegeStudents.list(slug), [slug]);
  const flat = useMemo(() => flattenTree(treeQuery.data?.items ?? []), [treeQuery.data]);
  const students: CollegeStudent[] = studentsQuery.data?.items ?? [];

  const [studentFilter, setStudentFilter] = useState("");
  const [previewing, setPreviewing] = useState(false);

  const filteredStudents = students.filter((s) => {
    const q = studentFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      s.fullName.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q)
    );
  });

  const runPreview = async (file: File): Promise<void> => {
    setPreviewing(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await previewFetcher(slug, fileBase64);
      onExcelChange({
        matchedRolls: res.matched.map((m) => m.rollNumber),
        matchedNames: res.matched.map((m) => m.fullName || m.rollNumber),
        unmatched: res.unmatched,
      });
      toast({
        variant: "success",
        title: `Matched ${res.summary.matched} of ${res.summary.total} roll numbers`,
      });
    } catch (err) {
      toast({ variant: "error", title: parseApiError(err).message });
    } finally {
      setPreviewing(false);
    }
  };

  const downloadTemplate = (): void => {
    void templateFetcher(slug)
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err: unknown) =>
        toast({ variant: "error", title: parseApiError(err).message }),
      );
  };

  return (
    <div className="space-y-5">
      {/* 1) Org-units / sections (multi-select) */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Users className="h-4 w-4 text-primary" /> Org-units &amp; sections
          {unitIds.size > 0 ? (
            <Badge variant="info">{unitIds.size} selected</Badge>
          ) : null}
        </p>
        {flat.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No org-units yet — add them under Academic structure.
          </p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
            {flat.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 text-sm text-ink"
                style={{ paddingLeft: `${u.depth * 14}px` }}
              >
                <Checkbox
                  checked={unitIds.has(u.id)}
                  onCheckedChange={() => onUnitIdsChange(toggle(unitIds, u.id))}
                />
                <span className="truncate">{u.name}</span>
                <Badge variant="neutral">{orgUnitTypeLabel(u.type)}</Badge>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* 2) Individual students (multi-select) */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">
          Individual students
          {studentIds.size > 0 ? (
            <Badge variant="info" className="ml-2">
              {studentIds.size} selected
            </Badge>
          ) : null}
        </p>
        <Input
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
          placeholder="Filter by name or roll number…"
          aria-label="Filter students"
        />
        {studentsQuery.loading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-subtle p-2">
            {filteredStudents.length === 0 ? (
              <p className="p-2 text-xs text-ink-muted">No students match.</p>
            ) : (
              filteredStudents.slice(0, 200).map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <Checkbox
                    checked={studentIds.has(s.id)}
                    onCheckedChange={() => onStudentIdsChange(toggle(studentIds, s.id))}
                  />
                  <span className="truncate">{s.fullName}</span>
                  <span className="text-xs text-ink-muted">{s.rollNumber}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      {/* 3) Excel roll-number upload → preview */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Upload className="h-4 w-4 text-primary" /> Excel roll numbers
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={downloadTemplate}>
            Download template
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-subtle px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken">
            {previewing ? "Reading…" : "Upload .xlsx"}
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void runPreview(file);
                e.target.value = "";
              }}
            />
          </label>
          {excel ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onExcelChange(null)}
            >
              Clear
            </Button>
          ) : null}
        </div>
        {excel ? (
          <div className="rounded-lg border border-subtle p-2 text-xs">
            <p className="text-success-fg">
              {excel.matchedRolls.length} matched
              {excel.matchedNames.length > 0
                ? `: ${excel.matchedNames.slice(0, 8).join(", ")}${
                    excel.matchedNames.length > 8 ? "…" : ""
                  }`
                : ""}
            </p>
            {excel.unmatched.length > 0 ? (
              <p className="mt-1 text-warning-fg">
                {excel.unmatched.length} unmatched:{" "}
                {excel.unmatched.slice(0, 8).join(", ")}
                {excel.unmatched.length > 8 ? "…" : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
