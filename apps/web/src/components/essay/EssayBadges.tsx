/**
 * Small presentational badges shared by the essays surface: score-source
 * transparency (AI-reviewed vs Auto-scored), difficulty, and grading status.
 */
import {
  EssayScoreSource,
  type EssayGradingStatus,
  type EssayRiskLevel,
} from "@codeapt/shared";
import { Cpu, ShieldAlert, Sparkles } from "lucide-react";

import { Badge } from "../ui/badge.js";

const DIFFICULTY_LABEL: Record<number, string> = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
};

export function DifficultyBadge({ level }: { level: number }) {
  const variant = level >= 3 ? "warning" : level === 2 ? "info" : "success";
  return <Badge variant={variant}>{DIFFICULTY_LABEL[level] ?? "—"}</Badge>;
}

/**
 * Distinguishes an AI-blended grade from a deterministic-only fallback so a
 * fallback never reads as a broken AI grade.
 */
export function SourceBadge({ source }: { source: EssayScoreSource | null }) {
  if (source === EssayScoreSource.AI_HYBRID) {
    return (
      <Badge
        variant="primary"
        title="Deterministic engine blended with AI review"
      >
        <Sparkles className="h-3 w-3" /> AI-reviewed
      </Badge>
    );
  }
  if (source === EssayScoreSource.DETERMINISTIC_FALLBACK) {
    return (
      <Badge
        variant="neutral"
        title="Scored by the deterministic engine (AI review unavailable)"
      >
        <Cpu className="h-3 w-3" /> Auto-scored
      </Badge>
    );
  }
  return null;
}

const STATUS_VARIANT: Record<
  EssayGradingStatus,
  "neutral" | "info" | "success" | "error"
> = {
  queued: "neutral",
  processing: "info",
  completed: "success",
  failed: "error",
};

export function GradingStatusBadge({ status }: { status: EssayGradingStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

const RISK_META: Record<
  EssayRiskLevel,
  { variant: "neutral" | "warning" | "error"; label: string }
> = {
  low: { variant: "neutral", label: "Low" },
  medium: { variant: "warning", label: "Medium" },
  high: { variant: "error", label: "High" },
};

/**
 * ADVISORY anti-cheat risk badge (level + optional score). A review aid only —
 * it never reflects a penalty or a change to the student's grade.
 */
export function RiskBadge({
  level,
  score,
}: {
  level: EssayRiskLevel;
  score?: number;
}) {
  const meta = RISK_META[level];
  return (
    <Badge variant={meta.variant} title="Advisory anti-cheat signal (review only)">
      <ShieldAlert className="h-3 w-3" /> {meta.label}
      {typeof score === "number" ? ` · ${score}` : null}
    </Badge>
  );
}
