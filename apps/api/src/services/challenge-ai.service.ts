/**
 * "Build with AI" authoring assist for the daily-challenge editor. Synchronously
 * asks the LLM gateway for a challenge DRAFT (CODE or MCQ) the admin can review,
 * edit, and save through the normal create path. This is an AUTHORING AID, not
 * the automatic pipeline: the API has no sandbox, so a CODE draft is NOT
 * validated by execution here — the admin verifies the test cases before
 * publishing (the automatic worker pipeline is the execution-validated path). An
 * MCQ has nothing to execute either way. Graceful: no provider →
 * `{ configured: false }`; unusable output → `{ draft: null }`.
 */
import {
  CodeLanguage,
  DailyQuestionType,
  aiDailyChallengeSchema,
  callLlmChatJson,
  hasLlmRouter,
  type AiBuildChallengeResponse,
  type DailyQuestionType as DailyQuestionTypeT,
} from "@codeapt/shared";

const SYSTEM_PROMPT =
  "You are a contest author creating ONE self-contained daily challenge — " +
  "either a CODE problem or a multiple-choice question (MCQ). Return STRICT " +
  "JSON ONLY (no prose, no code fences).\n" +
  'For CODE: {"questionType":"CODE","title":string,"statement":string,' +
  '"starterCode":string,"language":"python","referenceSolution":string,' +
  '"difficulty":"easy"|"medium"|"hard","testCases":[{"input":string,' +
  '"expectedOutput":string,"isHidden":boolean}]}. The program reads ALL input ' +
  "from stdin and writes ONLY the answer to stdout. `referenceSolution` MUST " +
  "be a COMPLETE Python 3 program that, for each test case's `input` on stdin, " +
  "prints EXACTLY that case's `expectedOutput`. Provide 3 to 5 cases, at least " +
  "one hidden.\n" +
  'For MCQ: {"questionType":"MCQ","title":string,"statement":string,' +
  '"difficulty":"easy"|"medium"|"hard","options":[string,...],' +
  '"correctOption":integer}. 3–5 options; `correctOption` is the 0-based index ' +
  "of the single correct option. Keep everything deterministic.";

function buildUserPrompt(
  topic: string | undefined,
  questionType: DailyQuestionTypeT | undefined,
): string {
  const kind =
    questionType === DailyQuestionType.MCQ
      ? "a multiple-choice question (MCQ)"
      : questionType === DailyQuestionType.CODE
        ? "a CODE problem"
        : "either a CODE problem or an MCQ";
  const base =
    `Create ${kind}, beginner-to-intermediate friendly. For CODE, ensure the ` +
    "reference solution truly produces each expected output for the given input.";
  return topic && topic.trim()
    ? `${base} Theme it around: ${topic.trim()}.`
    : `${base} Pick an interesting, common interview-style topic.`;
}

export async function buildAiChallengeDraft(
  topic?: string,
  questionType?: DailyQuestionTypeT,
): Promise<AiBuildChallengeResponse> {
  if (!hasLlmRouter()) return { configured: false, draft: null };

  const parsed = await callLlmChatJson(
    { url: "", apiKey: "", model: "", timeoutMs: 45_000 },
    SYSTEM_PROMPT,
    buildUserPrompt(topic, questionType),
    {
      kind: "generation",
      capability: "capable",
      maxTokens: 1500,
      feature: "daily_challenge",
    },
  );

  const result = aiDailyChallengeSchema.safeParse(parsed);
  if (!result.success) return { configured: true, draft: null };
  const c = result.data;

  if (c.questionType === DailyQuestionType.MCQ) {
    return {
      configured: true,
      draft: {
        questionType: DailyQuestionType.MCQ,
        title: c.title,
        description: c.statement,
        options: c.options,
        correctOption: c.correctOption,
        starterCode: "",
        language: CodeLanguage.PYTHON,
        referenceSolution: "",
        testCases: [],
      },
    };
  }

  return {
    configured: true,
    draft: {
      questionType: DailyQuestionType.CODE,
      title: c.title,
      description: c.statement,
      options: [],
      correctOption: 0,
      starterCode: c.starterCode,
      language: c.language,
      referenceSolution: c.referenceSolution,
      testCases: c.testCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: tc.isHidden,
      })),
    },
  };
}
