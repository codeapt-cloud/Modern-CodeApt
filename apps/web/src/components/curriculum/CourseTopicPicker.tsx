/**
 * Searchable curriculum-topic picker for the PLATFORM course-attach surface —
 * shared by the game / speaking / communication editors (S30) so the attach UX
 * is identical everywhere and lives in one place. Loads the type's selectable
 * topics via the injected `load`, filters by a Subject › Module › Topic label,
 * disables topics already attached to another assessment (except the current
 * selection), and offers a "None" option. Fails soft: a load error shows a line,
 * never blanks the editor (the Step-23 lesson).
 */
import type { GameTopicListResponse, GameTopicOption } from "@codeapt/shared";
import { useEffect, useState } from "react";

import { parseApiError } from "../../lib/api-client.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";

const topicLabel = (t: GameTopicOption): string =>
  [t.subjectName, t.moduleName, t.name].filter(Boolean).join(" › ");

export function CourseTopicPicker({
  value,
  onChange,
  load,
  noun,
}: {
  /** Currently attached topic id ("" = none). */
  value: string;
  onChange: (topicId: string) => void;
  /** Fetch the selectable topics of this content's type. */
  load: () => Promise<GameTopicListResponse>;
  /** e.g. "speaking assessment" — used in the empty-catalog hint. */
  noun: string;
}): JSX.Element {
  const [topics, setTopics] = useState<GameTopicOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void load()
      .then((r) => live && setTopics(r.items))
      .catch((e) => live && (setTopics([]), setLoadError(parseApiError(e).message)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = topics?.find((t) => t.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = (topics ?? []).filter((t) =>
    q ? topicLabel(t).toLowerCase().includes(q) : true,
  );
  const pick = (id: string): void => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="space-y-1">
      <Label htmlFor="course-topic">Curriculum topic (optional — course-attached)</Label>
      {topics === null ? (
        <p className="text-sm text-ink-muted">Loading topics…</p>
      ) : (
        <div className="relative">
          {loadError ? (
            <p className="mb-1 text-xs text-warning-fg">
              Couldn’t load topics ({loadError}). Leave blank, or retry by reopening.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Input
              id="course-topic"
              autoComplete="off"
              value={open ? query : selected ? topicLabel(selected) : ""}
              placeholder={
                topics.length === 0
                  ? `No topics exist yet — create one in a course`
                  : "Search topics, or leave blank (not course-attached)"
              }
              disabled={topics.length === 0}
              onFocus={() => {
                setOpen(true);
                setQuery("");
              }}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onChange={(e) => setQuery(e.target.value)}
            />
            {value ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => pick("")}>
                Clear
              </Button>
            ) : null}
          </div>
          {selected === null && value ? (
            <p className="mt-1 text-xs text-warning-fg">
              Attached to topic {value} (not in the current list).
            </p>
          ) : null}
          {open && topics.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-subtle bg-surface-base shadow-lg">
              <li>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick("");
                  }}
                >
                  None — not course-attached
                </button>
              </li>
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-ink-muted">
                  No topics match “{query}”.
                </li>
              ) : (
                filtered.map((t) => {
                  const isCurrent = t.id === value;
                  const disabled = t.attached && !isCurrent;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        className={`w-full px-3 py-2 text-left text-sm ${
                          disabled
                            ? "cursor-not-allowed text-ink-muted/60"
                            : "text-ink hover:bg-surface"
                        } ${isCurrent ? "bg-surface" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (!disabled) pick(t.id);
                        }}
                      >
                        {topicLabel(t)}
                        {disabled ? (
                          <span className="ml-2 text-xs">(already has a {noun})</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
