/**
 * THROWAWAY DEV/CALIBRATION HARNESS — NOT shipped, NOT wired into the app.
 *
 * Sanity-checks the deterministic essay scorer (post-rebalance + real
 * dictionary) against a labelled corpus, printing each dimension, its weighted
 * contribution, the bonus, and the exact spelling tokens flagged.
 *
 * It uses the REAL grading path — the same `scoreDeterministic` the worker
 * calls and the same injected `isKnownWord` dictionary — plus the REAL exported
 * `classifySpellingToken` to list flagged tokens (no scoring/dictionary is
 * reimplemented here; the only script-local logic is the loop that collects the
 * classifier's "error" verdicts for display).
 *
 * Run:  pnpm --filter @codeapt/worker exec tsx scripts/essay-calibration.ts
 */
import {
  ESSAY_BONUS_POINTS,
  ESSAY_BONUS_THRESHOLD,
  ESSAY_SCORE_WEIGHTS,
  classifySpellingToken,
  countWords,
  scoreDeterministic,
  type EssayScoreDimension,
} from "@codeapt/shared";

import { isKnownWord } from "../src/lib/dictionary.js";

// Fixed dimension order (matches ESSAY_SCORE_WEIGHTS declaration order).
const DIMS: EssayScoreDimension[] = [
  "grammar",
  "spelling",
  "punctuation",
  "readability",
  "vocabulary",
  "structure",
  "relevance",
];

interface TestEssay {
  label: string;
  expectation: string;
  keywords: string[];
  text: string;
}

// ---------------------------------------------------------------------------
// Corpus (verbatim to the calibration spec)
// ---------------------------------------------------------------------------

const REMOTE_KEYWORDS = [
  "remote work",
  "productivity",
  "collaboration",
  "flexibility",
  "communication",
];

const ESSAYS: TestEssay[] = [
  {
    label: "STRONG — on-topic, clean, rich",
    expectation: "high (~80+)",
    keywords: REMOTE_KEYWORDS,
    text: `Remote work has fundamentally reshaped how modern organizations operate, and the evidence increasingly suggests that it improves productivity rather than diminishing it. When employees are trusted to manage their own schedules, they tend to produce higher quality output with fewer distractions. This essay argues that remote work strengthens productivity through flexibility, thoughtful communication, and sustained collaboration.

First, flexibility allows employees to work when they are most focused. A software engineer who concentrates best in the early morning can begin before a traditional office would open, while a parent can adjust hours around family responsibilities. For example, a marketing analyst at a distributed company reported completing detailed reports in half the time once freed from constant interruptions. This autonomy converts wasted commuting hours into meaningful, focused effort.

Second, deliberate communication becomes a discipline rather than an accident. In an office, quick questions are often answered through noisy interruptions; remote teams instead document decisions clearly in shared channels. Because a project manager must write concise updates, information is preserved and searchable, and misunderstandings decline. Clear written communication therefore raises the overall quality of collaboration.

Third, collaboration does not disappear when teams are distributed; it simply adapts. Video meetings, shared documents, and asynchronous reviews let colleagues contribute across time zones. A design team spanning three continents, for instance, can hand off work continuously, so progress never stops. This continuous handoff demonstrates that collaboration and flexibility reinforce each other rather than competing.

Critics worry that remote work erodes connection, and that concern deserves attention. However, intentional practices such as regular check-ins and occasional gatherings preserve trust while retaining the benefits of autonomy. The goal is balance, not isolation.

In conclusion, remote work improves productivity when organizations invest in flexibility, communication, and collaboration. By trusting employees, documenting decisions, and embracing asynchronous teamwork, companies can achieve stronger results than a rigid office model allows. The future of productive work is not a single location but a thoughtful system that respects how people actually do their best work.`,
  },
  {
    label: "WEAK — thin, off-topic, sloppy",
    expectation: "low (~40s or below)",
    keywords: REMOTE_KEYWORDS,
    text: `so work is a thing that people do and i think work is good and work is important because work is work and you have to do work to get money and stuff. work is definately something everyone does everyday and it is really really important and it is important and stuff like that honestly. i recieve tasks and then i do the tasks and then more tasks come and it is a lot of tasks and tasks. working from a place is fine i guess and it does not really matter where you are as long as you do stuff and things. productivmity is when you do things and things are done and that is basically the whole point of everything really and truly.`,
  },
  {
    label: "POLISHED BUT SHALLOW — clean mechanics, little substance",
    expectation: "middle (~60s)",
    keywords: REMOTE_KEYWORDS,
    text: `Remote work is an interesting topic that many people think about these days. It is something that has become quite common, and there are many different opinions about it. Some people like it and some people do not, and both perspectives are certainly understandable in their own way.

There are various aspects to consider when thinking about this subject. It can be good in some situations and less ideal in others, depending on the circumstances involved. Productivity is often mentioned in these discussions, and it is clearly an important consideration for everyone. Communication also comes up frequently, as it tends to matter in most professional settings. Flexibility is another word that appears in many articles, though what it means can vary from person to person.

Overall, remote work is a subject that will continue to be discussed for a long time. There are many things that could be said about it, and reasonable people will keep exploring the question. In the end, it depends on many factors, and each person will form their own view based on what they value and what works best for them in their particular situation.`,
  },
  {
    label: "TECHNICAL — legit jargon + proper nouns (false-positive probe)",
    expectation: "spelling should NOT tank; few/no real flags",
    keywords: [
      "software",
      "deployment",
      "architecture",
      "scalability",
      "database",
    ],
    text: `Modern software deployment has evolved into a sophisticated discipline that balances speed with reliability. A well designed architecture separates concerns into small, independently deployable microservices, each responsible for a focused part of the system. This approach improves scalability, because individual components can be scaled without redeploying the entire application.

A typical backend might expose a GraphQL API through a middleware layer that handles authentication using OAuth. Behind that layer, a PostgreSQL database stores durable records, while Redis provides a fast cache for frequently accessed data. When an external event occurs, a webhook notifies the system so it can react promptly.

Container orchestration platforms such as Kubernetes coordinate these services across many machines, restarting failed instances and distributing load automatically. A deployment pipeline builds each service, runs tests, and promotes the release only when every check passes.

Engineers like Vinay, working from Hyderabad, rely on this architecture to ship changes several times a day with confidence. By combining automated testing, observability, and careful rollout strategies, teams achieve dependable deployment at scale while keeping the overall software system maintainable.`,
  },
  {
    label: "BRITISH/INDIAN ENGLISH — spelling-variant probe",
    expectation: "variants should NOT be flagged",
    keywords: [
      "environment",
      "pollution",
      "policy",
      "sustainability",
      "climate",
    ],
    text: `Protecting the environment is one of the defining challenges of our era, and thoughtful policy must sit at the centre of any credible response. As the climate continues to change, governments and citizens alike are being asked to analyse their choices and favour more sustainable habits.

Pollution remains a visible symptom of deeper problems. When we organise our cities around cleaner transport and renewable energy, we begin to change collective behaviour in lasting ways. A national programme that rewards efficient industry can shift incentives without punishing honest labour.

Sustainability is not merely an environmental slogan; it is an economic strategy. Communities that favour long term thinking tend to protect both their natural resources and their future prosperity. The colour of the sky and the quality of the air are shared inheritances, and our behaviour today determines what remains for the next generation.

Ultimately, sound policy, informed by science and guided by a genuine concern for the climate, offers the clearest path toward a sustainable future.`,
  },
];

// ---------------------------------------------------------------------------
// Debug-only helper: list the tokens the REAL classifier flags as misspelled.
// Uses the exported classifySpellingToken (same code the scorer uses) — this is
// NOT a reimplementation of the spelling logic, only a collector for display.
// ---------------------------------------------------------------------------

function flaggedSpellingTokens(text: string): string[] {
  const flagged: string[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    if (classifySpellingToken(raw, isKnownWord) === "error") flagged.push(raw);
  }
  return flagged;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const padL = (s: string | number, n: number): string => String(s).padStart(n);
const line = (c = "="): string => c.repeat(72);

function report(essay: TestEssay, index: number): { final: number } {
  const result = scoreDeterministic(
    essay.text,
    { referenceKeywords: essay.keywords },
    { isKnownWord },
  );

  console.log(line());
  console.log(`[${index + 1}] ${essay.label}`);
  console.log(`    expectation : ${essay.expectation}`);
  console.log(
    `    words       : ${countWords(essay.text)}    ` +
      `final: ${result.total.toFixed(2)}    ` +
      `bonus: ${result.bonusApplied ? "YES (+" + ESSAY_BONUS_POINTS + ")" : "no"}`,
  );
  console.log(`    keywords    : ${essay.keywords.join(", ")}`);
  console.log(line("-"));
  console.log(
    `    ${pad("dimension", 13)}${padL("sub", 7)}${padL("weight", 9)}${padL("contribution", 14)}`,
  );

  let weightedSum = 0;
  for (const dim of DIMS) {
    const sub = result.dimensions[dim];
    const weight = ESSAY_SCORE_WEIGHTS[dim];
    const contribution = sub * weight;
    weightedSum += contribution;
    console.log(
      `    ${pad(dim, 13)}${padL(sub.toFixed(2), 7)}${padL(weight.toFixed(2), 9)}${padL(contribution.toFixed(2), 14)}`,
    );
  }
  console.log(line("-"));
  console.log(
    `    weighted sum (pre-bonus): ${weightedSum.toFixed(2)}` +
      (result.bonusApplied
        ? `   + bonus ${ESSAY_BONUS_POINTS} = ${result.total.toFixed(2)}`
        : `   = ${result.total.toFixed(2)} (capped 0..100)`),
  );
  console.log(
    `    bonus rule  : vocab/structure/relevance all >= ${ESSAY_BONUS_THRESHOLD}? ` +
      `${result.bonusApplied ? "YES" : "no"}`,
  );

  const flagged = flaggedSpellingTokens(essay.text);
  console.log(
    `    flagged spelling tokens (${flagged.length}): ` +
      (flagged.length === 0 ? "(none)" : flagged.join(", ")),
  );
  console.log("");

  return { final: result.total };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("");
console.log("ESSAY SCORING CALIBRATION (deterministic engine — dev-only)");
console.log(`dictionary loaded via the real worker isKnownWord predicate`);
console.log("");

const summary = ESSAYS.map((essay, i) => ({
  label: essay.label,
  expectation: essay.expectation,
  final: report(essay, i).final,
}));

console.log(line());
console.log("SUMMARY (label -> final vs expectation)");
console.log(line("-"));
for (const s of summary) {
  console.log(`  ${padL(s.final.toFixed(1), 6)}   ${pad(s.label, 52)} [${s.expectation}]`);
}
console.log(line());
console.log("");
