/**
 * AssistantPanel (Step 41) — the docked guide. Rendered once at the provider level
 * so the conversation + ticks survive in-app navigation and collapse/expand.
 *
 * Layout: it PUSHES the page (reserves a right gutter on #root at md+) rather than
 * floating over the content it's guiding — an admin needs to see the page and the
 * worklist at once. Collapse shrinks it to a slim edge tab (state remembered).
 * Narrow screens (< md) can't fit a side-by-side panel, so there it's a full-screen
 * overlay and does NOT push (pushing would crush the page); the edge tab still
 * toggles it.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAssistant } from "../../providers/AssistantProvider.js";
import { Button } from "../ui/button.js";
import { Textarea } from "../ui/textarea.js";
import { AssistantConversation } from "./AssistantConversation.js";

const PANEL_WIDTH = "28rem";

export function AssistantPanel() {
  const {
    open,
    collapsed,
    scope,
    entries,
    busy,
    closePanel,
    setCollapsed,
    send,
    toggleStep,
  } = useAssistant();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Push the page: reserve a right gutter on #root while expanded, at md+ only.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const apply = (): void => {
      const wide =
        typeof window.matchMedia === "function"
          ? window.matchMedia("(min-width: 768px)").matches
          : true;
      root.style.paddingRight = open && !collapsed && wide ? PANEL_WIDTH : "";
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.paddingRight = "";
    };
  }, [open, collapsed]);

  useEffect(() => {
    if (open && !collapsed && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, busy, open, collapsed]);

  if (!open || !scope) return null;

  // Collapsed → a slim edge tab that restores the panel.
  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="assistant-edge"
        onClick={() => setCollapsed(false)}
        aria-label="Expand admin assistant"
        className="fixed right-0 top-1/2 z-50 -translate-y-1/2 rounded-l-lg border border-r-0 border-subtle bg-surface-raised px-2 py-4 text-xs font-medium text-ink shadow-lg [writing-mode:vertical-rl]"
      >
        ✨ Assistant
      </button>
    );
  }

  const submit = (): void => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send(text);
  };

  const scopeLabel =
    scope.kind === "college" ? `College: ${scope.slug}` : "Platform-wide";

  return (
    <aside
      data-testid="assistant-panel"
      style={{ width: PANEL_WIDTH }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l border-subtle bg-surface-base shadow-2xl md:!w-[28rem]"
      aria-label="Admin assistant"
    >
      <header className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Admin guide</h2>
          <p className="text-[11px] text-ink-muted">{scopeLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            data-testid="assistant-collapse"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse assistant"
          >
            »
          </Button>
          <Button size="sm" variant="ghost" onClick={closePanel} aria-label="Close assistant">
            ✕
          </Button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
        {entries.length === 0 ? (
          <div className="mt-6 text-center text-sm text-ink-muted">
            <p>Ask "how do I…" and I'll give you a checklist to work through.</p>
            <p className="mt-2 text-xs">
              I only explain and link — I never change anything myself.
            </p>
          </div>
        ) : (
          <AssistantConversation
            entries={entries}
            busy={busy}
            onToggleStep={toggleStep}
            slug={scope.kind === "college" ? scope.slug : undefined}
            onNavigate={(path) => navigate(path)}
          />
        )}
      </div>

      <div className="border-t border-subtle p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="How do I…?  (Enter to send, Shift+Enter for a new line)"
          className="h-20 text-sm"
          disabled={busy}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={submit} loading={busy} disabled={busy || !draft.trim()}>
            Send
          </Button>
        </div>
      </div>
    </aside>
  );
}
