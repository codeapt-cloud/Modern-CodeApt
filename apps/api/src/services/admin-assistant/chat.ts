/**
 * The conversation loop (Step 40: read-only GUIDE). `callLlmChatJson` is single-
 * shot, so each turn re-serialises the client-held transcript + established facts
 * and asks the model for its next structured decision. The guide only ever READS
 * (to look up a capability or situate an answer in the admin's data) or SAYS
 * (ordered how-to guidance). There is NO write/propose path — it cannot change
 * anything, and the prompt makes it speak that way. `null` from the LLM → a plain
 * "temporarily unavailable" degrade; the guide never claims to have done anything.
 */
import {
  ADMIN_ASSISTANT_MAX_READ_CHARS,
  ADMIN_ASSISTANT_MAX_STEPS,
  callLlmChatJson,
  isPlatformAdmin,
  type AdminAssistantReply,
  type AdminAssistantTurn,
} from "@codeapt/shared";
import { z } from "zod";

import { env } from "../../config/env.js";
import { AppError } from "../../errors/app-error.js";
import { logger } from "../../lib/logger.js";
import { isKnownRoute } from "./capabilities.js";
import { dispatchRead } from "./dispatch.js";
import { ADMIN_ASSISTANT_TOOLS } from "./registry.js";
import type { AssistantContext } from "./types.js";

const guideStepSchema = z.object({
  text: z.string().min(1).max(600),
  route: z.string().max(200).optional(),
  control: z.string().max(120).optional(),
  prerequisite: z.string().max(400).optional(),
  gotcha: z.string().max(400).optional(),
});
const decisionSchema = z.object({
  action: z.enum(["say", "read", "guide"]),
  message: z.string().optional(),
  tool: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  steps: z.array(guideStepSchema).max(20).optional(),
});

function llmConfig() {
  return {
    url: env.ESSAY_LLM_URL,
    apiKey: env.ESSAY_LLM_API_KEY,
    model: env.ESSAY_LLM_MODEL,
    timeoutMs: env.ESSAY_AI_TIMEOUT_MS,
  };
}

function toolsFor(ctx: AssistantContext): typeof ADMIN_ASSISTANT_TOOLS {
  const superOk = isPlatformAdmin(ctx.role);
  return ADMIN_ASSISTANT_TOOLS.filter((t) => t.access !== "super" || superOk);
}

function buildCatalog(ctx: AssistantContext): string {
  return toolsFor(ctx)
    .map((t) => `- ${t.name} [read]: ${t.description} args: ${t.argHint}`)
    .join("\n");
}

function buildSystemPrompt(ctx: AssistantContext, catalog: string): string {
  const scopeLine =
    ctx.scope === "college"
      ? "You are helping within ONE college (its tenant is fixed by the session). Never ask for or supply a college id."
      : "You are helping a super admin platform-wide. For a read that targets one college, include that college's id as args.collegeId (resolve it once via list_colleges).";
  return [
    "You are the CodeApt admin GUIDE. You help an administrator do a task THEMSELVES by giving exact, ordered steps. You have NO ability to change anything — you only read and explain. Never say you created, published, enabled, deleted or changed anything; say where THEY click.",
    scopeLine,
    "",
    "RESPONSE FORMAT — reply with a SINGLE JSON object, nothing else:",
    '  { "action": "read",  "tool": "<name>", "args": { ... } }                 // look something up',
    '  { "action": "guide", "message": "<one-line lead-in>", "steps": [ ... ] } // ordered how-to',
    '  { "action": "say",   "message": "<text>" }                               // a question, or a plain / not-possible answer',
    "",
    "A guide STEP is an object: { text, route?, control?, prerequisite?, gotcha? }",
    "  - text: the instruction for this step.",
    "  - route: the SPA path to deep-link to (copy it VERBATIM from a capability_details result; omit if you don't have an exact one — never invent a path).",
    "  - control: the exact button/label to look for (copy it verbatim from capability_details).",
    "  - prerequisite: something that must be true first (shown distinctly).",
    "  - gotcha: a failure/pitfall to expect (shown distinctly).",
    "",
    "HOW TO ANSWER a 'how do I X' question:",
    "1. FIRST call capability_details with keywords for the task to get the authoritative route, navigation, exact button label, prerequisites, gate and failure modes. NEVER invent steps from memory — if capability_details returns no match, the product likely can't do it (answer with action \"say\" explaining that).",
    "2. Optionally call a data read (list_exams, list_org_units, entitlements, …) to SITUATE the guidance (\"you already have a SPEAKING topic, so skip to step 3\"; \"Communication isn't enabled for this college\").",
    "3. Then answer with action \"guide\": break it into ordered STEPS, each copying the route + control verbatim from the capability data, with the prerequisite on the step that needs it and the gotcha where it bites. Use action \"say\" (not guide) for a clarifying question or when the thing isn't possible.",
    "",
    "RULES:",
    "- NEVER claim to perform an action. You guide; the admin acts.",
    "- Say plainly when something isn't possible, and why (e.g. there is no create-a-course-from-a-document path; a game set can't attach to a course without a GAME topic). Don't invent a workaround.",
    "- Don't re-read something already in the conversation or the established facts.",
    "- If a lookup errors, relay it plainly; don't retry blindly.",
    "",
    "AVAILABLE READ TOOLS:",
    catalog,
  ].join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[truncated]`;
}

interface ReadTrace {
  tool: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

function buildUserPrompt(
  messages: AdminAssistantTurn[],
  reads: ReadTrace[],
  knownFacts: string[],
): string {
  const convo = messages
    .map((m) => `${m.role === "user" ? "Admin" : "Guide"}: ${m.content}`)
    .join("\n");
  const factsBlock =
    knownFacts.length > 0
      ? `\n\nFACTS ALREADY ESTABLISHED (reuse — do NOT re-read):\n${truncate(
          knownFacts.join("\n"),
          ADMIN_ASSISTANT_MAX_READ_CHARS,
        )}`
      : "";
  let readBlock = "";
  if (reads.length > 0) {
    const serialized = reads
      .map((r) =>
        r.error
          ? `TOOL ${r.tool} ERROR: ${r.error}`
          : `TOOL ${r.tool} RESULT: ${JSON.stringify(r.result)}`,
      )
      .join("\n");
    readBlock = `\n\nLOOKUPS THIS TURN (use these):\n${truncate(
      serialized,
      ADMIN_ASSISTANT_MAX_READ_CHARS,
    )}`;
  }
  return `CONVERSATION SO FAR:\n${convo}${factsBlock}${readBlock}\n\nReturn ONLY the JSON object for your next action.`;
}

function factFromRead(r: ReadTrace): string {
  if (r.error) return `${r.tool} error: ${r.error}`;
  return `${r.tool}: ${truncate(JSON.stringify(r.result), 600)}`;
}

function errMessage(err: unknown): string {
  return err instanceof AppError ? err.message : "The lookup failed.";
}

export async function handleChat(
  ctx: AssistantContext,
  messages: AdminAssistantTurn[],
  knownFacts: string[] = [],
): Promise<AdminAssistantReply> {
  const system = buildSystemPrompt(ctx, buildCatalog(ctx));
  const reads: ReadTrace[] = [];
  const toolsUsed: string[] = [];
  const factsOut: string[] = [...knownFacts];
  let lastToolError: string | null = null;
  let steps = 0;
  let creditsSpent = 0;

  while (steps < ADMIN_ASSISTANT_MAX_STEPS) {
    const raw = await callLlmChatJson(
      llmConfig(),
      system,
      buildUserPrompt(messages, reads, factsOut),
      {
        kind: "generation",
        capability: "capable",
        maxTokens: 800,
        feature: "admin_assistant",
        collegeId: ctx.collegeId ?? undefined,
      },
    );
    steps += 1;
    if (raw === null) {
      return {
        kind: "unavailable",
        message:
          "The guide is temporarily unavailable — the AI service didn't respond. Please try again shortly.",
        toolsUsed,
        facts: factsOut,
        creditsSpent,
        modelTurns: steps,
      };
    }
    creditsSpent += 1;

    const parsed = decisionSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(
        { scope: ctx.scope, issues: parsed.error.issues },
        "admin-assistant: model returned an unparseable decision",
      );
      return {
        kind: "message",
        message: lastToolError
          ? `I couldn't complete that lookup: ${lastToolError}`
          : "I had trouble forming a response — could you rephrase that?",
        toolsUsed,
        facts: factsOut,
        creditsSpent,
        modelTurns: steps,
      };
    }
    const decision = parsed.data;

    if (decision.action === "say") {
      return {
        kind: "message",
        message: decision.message ?? "",
        toolsUsed,
        facts: factsOut,
        creditsSpent,
        modelTurns: steps,
      };
    }

    if (decision.action === "guide") {
      // Ground every deep link: keep a step's route ONLY if it's a known map
      // route (⇒ asserted to exist in the SPA). An invented route is stripped,
      // not followed — the step keeps its text.
      const guideSteps = (decision.steps ?? []).map((s) => ({
        text: s.text,
        route: s.route && isKnownRoute(s.route) ? s.route : undefined,
        control: s.control,
        prerequisite: s.prerequisite,
        gotcha: s.gotcha,
      }));
      return {
        kind: "guide",
        message: decision.message ?? "",
        steps: guideSteps,
        toolsUsed,
        facts: factsOut,
        creditsSpent,
        modelTurns: steps,
      };
    }

    // action === "read"
    if (!decision.tool) {
      return {
        kind: "message",
        message: "Could you clarify what you'd like to know?",
        toolsUsed,
        facts: factsOut,
        creditsSpent,
        modelTurns: steps,
      };
    }
    toolsUsed.push(decision.tool);
    const trace: ReadTrace = await (async (): Promise<ReadTrace> => {
      try {
        const data = await dispatchRead(ctx, decision.tool!, decision.args ?? {});
        return { tool: decision.tool!, args: decision.args ?? {}, result: data };
      } catch (err) {
        return { tool: decision.tool!, args: decision.args ?? {}, error: errMessage(err) };
      }
    })();
    reads.push(trace);
    if (trace.error) {
      lastToolError = trace.error;
      logger.warn(
        { scope: ctx.scope, tool: trace.tool, error: trace.error },
        "admin-assistant: read tool failed",
      );
    }
    const fact = factFromRead(trace);
    if (!factsOut.includes(fact)) factsOut.push(fact);
  }

  return {
    kind: "message",
    message: lastToolError
      ? `I couldn't complete that lookup: ${lastToolError}`
      : "I need a bit more detail — could you clarify what you'd like to do?",
    toolsUsed,
    facts: factsOut,
    creditsSpent,
    modelTurns: steps,
  };
}
