/**
 * AssistantProvider (Step 40/41). Holds the read-only guide conversation ABOVE the
 * router so it survives in-app navigation AND collapse/expand, and mirrors it to
 * sessionStorage so a full reload mid-task doesn't lose the worklist or the ticks.
 * Plain React context, no new state library. Guidance arrives as STRUCTURED steps
 * (never markdown) that render as a checklist; tick state lives on the entry.
 *
 * Why sessionStorage (not just memory, not localStorage): being halfway through a
 * 9-step course setup and losing it to an accidental refresh is exactly when the
 * guide matters; sessionStorage keeps it for the tab's session without leaking a
 * stale worklist into a brand-new session days later.
 */
import { type AdminAssistantTurn, type AdminGuideStep } from "@codeapt/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, parseApiError } from "../lib/api-client.js";

export type AssistantScope =
  | { kind: "platform" }
  | { kind: "college"; slug: string };

export type AssistantEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; tools: string[] }
  | {
      id: string;
      role: "guide";
      intro: string;
      steps: AdminGuideStep[];
      checked: boolean[];
      tools: string[];
    }
  | { id: string; role: "error"; text: string; retryText?: string };

interface AssistantContextValue {
  open: boolean;
  collapsed: boolean;
  scope: AssistantScope | null;
  entries: AssistantEntry[];
  busy: boolean;
  openPanel: (scope: AssistantScope) => void;
  closePanel: () => void;
  setCollapsed: (v: boolean) => void;
  send: (text: string) => Promise<void>;
  toggleStep: (entryId: string, index: number) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);
const STORAGE_KEY = "codeapt.assistant.v1";

interface Persisted {
  scope: AssistantScope | null;
  entries: AssistantEntry[];
  turns: AdminAssistantTurn[];
  facts: string[];
  open: boolean;
  collapsed: boolean;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

let seq = 0;
const nextId = (): string => `ae${Date.now().toString(36)}-${(seq += 1)}`;

function sameScope(a: AssistantScope | null, b: AssistantScope): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  return a.kind === "platform" || a.slug === (b as { slug: string }).slug;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const restored = useRef<Persisted | null>(loadPersisted());
  const [open, setOpen] = useState(restored.current?.open ?? false);
  const [collapsed, setCollapsedState] = useState(restored.current?.collapsed ?? false);
  const [scope, setScope] = useState<AssistantScope | null>(
    restored.current?.scope ?? null,
  );
  const [entries, setEntries] = useState<AssistantEntry[]>(
    restored.current?.entries ?? [],
  );
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef<AdminAssistantTurn[]>(restored.current?.turns ?? []);
  const factsRef = useRef<string[]>(restored.current?.facts ?? []);

  // Mirror to sessionStorage on every change that matters.
  useEffect(() => {
    try {
      const snapshot: Persisted = {
        scope,
        entries,
        turns: turnsRef.current,
        facts: factsRef.current,
        open,
        collapsed,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* storage unavailable — degrade to in-memory only */
    }
  }, [scope, entries, open, collapsed, busy]);

  const openPanel = useCallback((next: AssistantScope) => {
    setScope((prev) => {
      if (!sameScope(prev, next)) {
        setEntries([]);
        turnsRef.current = [];
        factsRef.current = [];
        return next;
      }
      return prev;
    });
    setOpen(true);
    setCollapsedState(false);
  }, []);

  const closePanel = useCallback(() => setOpen(false), []);
  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);

  const toggleStep = useCallback((entryId: string, index: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId && e.role === "guide"
          ? { ...e, checked: e.checked.map((c, i) => (i === index ? !c : c)) }
          : e,
      ),
    );
  }, []);

  const chat = useCallback(
    (messages: AdminAssistantTurn[]) => {
      const body = { messages, knownFacts: factsRef.current };
      return scope?.kind === "college"
        ? api.collegeAssistant.chat(scope.slug, body)
        : api.adminAssistant.chat(body);
    },
    [scope],
  );

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || busy || !scope) return;
      setEntries((prev) => [...prev, { id: nextId(), role: "user", text: trimmed }]);
      const sent: AdminAssistantTurn[] = [
        ...turnsRef.current,
        { role: "user", content: trimmed },
      ];
      setBusy(true);
      try {
        const reply = await chat(sent);
        factsRef.current = reply.facts;
        if (reply.kind === "unavailable") {
          setEntries((prev) => [
            ...prev,
            { id: nextId(), role: "error", text: reply.message, retryText: trimmed },
          ]);
          return;
        }
        if (reply.kind === "guide") {
          const steps = reply.steps ?? [];
          turnsRef.current = [
            ...sent,
            {
              role: "assistant",
              content: `${reply.message}\n${steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}`,
            },
          ];
          setEntries((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "guide",
              intro: reply.message,
              steps,
              checked: steps.map(() => false),
              tools: reply.toolsUsed,
            },
          ]);
          return;
        }
        // kind === "message"
        turnsRef.current = [
          ...sent,
          { role: "assistant", content: reply.message || "(no message)" },
        ];
        setEntries((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", text: reply.message, tools: reply.toolsUsed },
        ]);
      } catch (err) {
        const parsed = parseApiError(err);
        setEntries((prev) => [
          ...prev,
          { id: nextId(), role: "error", text: parsed.message, retryText: trimmed },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, scope, chat],
  );

  const value = useMemo<AssistantContextValue>(
    () => ({
      open,
      collapsed,
      scope,
      entries,
      busy,
      openPanel,
      closePanel,
      setCollapsed,
      send,
      toggleStep,
    }),
    [open, collapsed, scope, entries, busy, openPanel, closePanel, setCollapsed, send, toggleStep],
  );

  return (
    <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return ctx;
}
