/**
 * The bank filter bar (shared by the college picker + the super-admin screen):
 * a search box (text/tags → the backend `q` param) plus chip rows. Facets are
 * computed SERVER-SIDE across the whole bank (respecting scope/grant), so they
 * show every distinct value, not just the current page's — and they CASCADE:
 * category / company / difficulty are top-level (always fully shown), while
 * sub-topic + tags narrow to the selected category (sub-topic is a child of
 * category, so with Category = All the row is hidden behind a hint instead of a
 * ~70-value wall). Picking a category clears an incompatible sub-topic/tag.
 * Rows with many values collapse behind a "show all / show less" toggle.
 * Presentational: it takes the current filter state + the server facets and
 * reports changes up; the parent owns the query + fetch.
 */
import {
  QUESTION_DIFFICULTY_VALUES,
  type BankFacets,
} from "@codeapt/shared";
import { Search } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn.js";
import type { BankFilterState } from "../../lib/question-bank-ui.js";
import { Input } from "../ui/input.js";

/** Chip rows longer than this collapse behind a "show all" toggle. */
const COLLAPSE_AFTER = 12;

function Chip({
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
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-white"
          : "border-subtle text-ink-secondary hover:bg-surface-overlay hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ChipRow({
  label,
  values,
  active,
  onPick,
  labelFor,
}: {
  label: string;
  values: string[];
  active: string;
  onPick: (value: string) => void;
  labelFor?: (value: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (values.length === 0) return null;

  const collapsible = values.length > COLLAPSE_AFTER;
  // Always keep the active value visible even when collapsed.
  const shown =
    collapsible && !expanded
      ? [...new Set([...values.slice(0, COLLAPSE_AFTER), ...(active ? [active] : [])])]
      : values;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-ink-muted">{label}</span>
      <Chip active={active === ""} onClick={() => onPick("")}>
        All
      </Chip>
      {shown.map((v) => (
        <Chip key={v} active={active === v} onClick={() => onPick(v)}>
          {labelFor ? labelFor(v) : v}
        </Chip>
      ))}
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show less" : `Show all ${values.length}`}
        </button>
      ) : null}
    </div>
  );
}

export function BankFilterBar({
  filters,
  facets,
  onChange,
}: {
  filters: BankFilterState;
  facets: BankFacets;
  onChange: (patch: Partial<BankFilterState>) => void;
}) {
  return (
    <div className="space-y-3">
      <Input
        leading={<Search />}
        placeholder="Search question text or tags…"
        value={filters.q}
        onChange={(e) => onChange({ q: e.target.value })}
        aria-label="Search bank questions"
      />
      {/* Category is a top-level (parent) axis — always fully shown. Picking one
          clears any now-incompatible sub-category / tag selection. */}
      <ChipRow
        label="Category"
        values={facets.categories}
        active={filters.category}
        onPick={(category) => onChange({ category, subCategory: "", tag: "" })}
      />
      {/* Sub-category is a CHILD of category: only meaningful within a subject.
          With Category = All we hide the wall and show a hint instead. */}
      {filters.category ? (
        <ChipRow
          label="Sub-topic"
          values={facets.subCategories}
          active={filters.subCategory}
          onPick={(subCategory) => onChange({ subCategory, tag: "" })}
        />
      ) : (
        <p className="text-xs text-ink-muted">
          <span className="mr-1 font-medium">Sub-topic</span>· select a category to
          filter by sub-topic
        </p>
      )}
      <ChipRow
        label="Company"
        values={facets.companies}
        active={filters.company}
        onPick={(company) => onChange({ company })}
      />
      {/* Tags are category-scoped server-side, so they narrow with the subject. */}
      <ChipRow
        label="Tags"
        values={facets.tags}
        active={filters.tag}
        onPick={(tag) => onChange({ tag })}
      />
      <ChipRow
        label="Difficulty"
        values={[...QUESTION_DIFFICULTY_VALUES]}
        active={filters.difficulty}
        onPick={(difficulty) =>
          onChange({ difficulty: difficulty as BankFilterState["difficulty"] })
        }
        labelFor={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
      />
    </div>
  );
}
