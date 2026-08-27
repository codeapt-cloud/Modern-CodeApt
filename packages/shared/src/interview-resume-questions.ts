/**
 * PURE resume-anchored question generation (Step 36 D). The Step-35 fix passed the
 * resume analysis into the LLM prompt, but questions still came back generic — the
 * generator "barely used the resume". Two problems: (1) the LLM was only NUDGED,
 * not shown the target style; (2) when the LLM degraded we fell back to a fully
 * generic role bank. This module turns the extracted resume HIGHLIGHTS into
 * specific probing questions deterministically — used as the degrade fallback AND
 * as the fixture-reproducible demonstration of the target style. The LLM prompt
 * (interview-ai) is separately strengthened with a one-shot example of this shape.
 *
 * Target shape (from the fixture): reference a SPECIFIC thing the candidate did,
 * then probe it — "You validated the InsightFace attendance engine to zero false
 * positives — what was your test set, and what would have made you distrust that
 * number?"; "JARVIS falls back across six LLM providers — how did you decide when
 * to fail over versus retry?"
 */
import { InterviewQuestionCategory } from "./enums.js";

export interface ResumeQuestion {
  readonly category: InterviewQuestionCategory;
  readonly text: string;
}

export interface ResumeAnalysisLike {
  readonly highlights?: readonly string[];
  readonly skills?: readonly string[];
}

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Frame a highlight into a subject clause. A proper-noun/all-caps opener
 *  ("JARVIS…", "AAMS…") is kept as-is; a bare verb phrase ("validated…") becomes
 *  "you validated…" so the sentence is grammatical either way. */
function subject(h: string): string {
  const first = h.trim().split(/\s+/)[0] ?? "";
  const proper = first.length > 1 && first === first.toUpperCase();
  return proper ? h.trim() : `you ${h.trim()[0]!.toLowerCase()}${h.trim().slice(1)}`;
}

/** A probe tailored to what the highlight is about — a measured claim, a
 *  fallback/retry design, a system build, or a general "hardest decision". */
function technicalProbe(h: string): string {
  const t = h.toLowerCase();
  if (/\b(zero|\d+%|\d+\s*(false|fps|users|concurrent)|accuracy|false positive|precision|recall)\b/.test(t)) {
    return "what was your test set, and what would have made you distrust that number?";
  }
  if (/\b(fallback|fall back|retry|failover|fail over|providers?|backends?|circuit)\b/.test(t)) {
    return "how did you decide when to fail over versus retry, and what did you do on repeated failure?";
  }
  if (/\b(auth|jwt|token|approval|authority|audit|permission|security|sign)\b/.test(t)) {
    return "what was the threat you were guarding against, and where could it still be bypassed?";
  }
  if (/\b(scale|concurrent|throughput|latency|queue|load|realtime|websocket|socket)\b/.test(t)) {
    return "where did it start to strain under load, and what was the bottleneck?";
  }
  if (/\b(design|built|build|architect|system|engine|pipeline|daemon|manager)\b/.test(t)) {
    return "what was the hardest technical decision there, and what did you trade off?";
  }
  return "what part was hardest to get right, and how did you verify it worked?";
}

function behaviouralProbe(): string {
  return "what were you most responsible for, and what was the hardest moment?";
}

/** Assign a category from the highlight's content (technical signals → technical). */
function categoryFor(h: string): InterviewQuestionCategory {
  // No trailing \b so plurals/stems match ("providers", "systems", "APIs").
  return /\b(built|build|design|engine|system|api|database|model|scal|auth|deploy|pipeline|algorithm|latenc|concurren|provider|backend|jwt|websocket|opencv|recognition|orchestrat)/i.test(
    h,
  )
    ? InterviewQuestionCategory.TECHNICAL
    : InterviewQuestionCategory.BEHAVIOURAL;
}

/** One resume-anchored question for a highlight, in the target category. */
export function resumeQuestionFor(
  highlight: string,
  category: InterviewQuestionCategory,
): string {
  const lead = cap(subject(highlight));
  const probe =
    category === InterviewQuestionCategory.TECHNICAL
      ? technicalProbe(highlight)
      : behaviouralProbe();
  return `${lead} — ${probe}`;
}

/**
 * Build up to `behaviouralCount` behavioural + `technicalCount` technical
 * questions anchored to the resume highlights. Highlights are matched to their
 * natural category first; if a bucket is short, remaining highlights (and then
 * skills) top it up so questions stay resume-specific rather than generic. Returns
 * [] when there are no highlights (caller keeps its generic role bank).
 */
export function buildResumeQuestions(
  analysis: ResumeAnalysisLike | null,
  behaviouralCount: number,
  technicalCount: number,
): ResumeQuestion[] {
  const highlights = (analysis?.highlights ?? []).map((h) => h.trim()).filter(Boolean);
  if (highlights.length === 0) return [];

  const tech: string[] = [];
  const beh: string[] = [];
  for (const h of highlights) {
    (categoryFor(h) === InterviewQuestionCategory.TECHNICAL ? tech : beh).push(h);
  }
  // A shared pool to top up whichever bucket runs short (highlights, then skills).
  const spillover = [...highlights];
  const skills = (analysis?.skills ?? []).map((s) => s.trim()).filter(Boolean);

  const usedHl = new Set<string>();
  const take = (bucket: string[], category: InterviewQuestionCategory, count: number): ResumeQuestion[] => {
    const out: ResumeQuestion[] = [];
    const pull = (list: string[]): string | null => {
      while (list.length) {
        const h = list.shift()!;
        if (!usedHl.has(h)) {
          usedHl.add(h);
          return h;
        }
      }
      return null;
    };
    while (out.length < count) {
      const h = pull(bucket) ?? pull(spillover);
      if (h) {
        out.push({ category, text: resumeQuestionFor(h, category) });
        continue;
      }
      // Highlights exhausted → a resume-anchored skill question (still specific).
      const skill = skills.shift();
      if (!skill) break;
      out.push({
        category,
        text:
          category === InterviewQuestionCategory.TECHNICAL
            ? `You list ${skill} on your resume — where have you used it in production, and what surprised you?`
            : `You list ${skill} — tell me about a time it let you down and what you did.`,
      });
    }
    return out;
  };

  const technical = take(tech, InterviewQuestionCategory.TECHNICAL, Math.max(0, technicalCount));
  const behavioural = take(beh, InterviewQuestionCategory.BEHAVIOURAL, Math.max(0, behaviouralCount));
  return [...behavioural, ...technical];
}
