/**
 * Idempotent daily-challenge seed.
 *
 *   pnpm --filter @codeapt/api seed:challenges          # today = CODE (default)
 *   pnpm --filter @codeapt/api seed:challenges mcq      # today = MCQ
 *
 * Seeds a week of DailyQuestions across recent IST days (mix of MCQ + CODE),
 * with TODAY's type chosen by the CLI arg so the browser demo can show both.
 * CODE questions carry visible sample + hidden test cases; the starter greets
 * the first stdin line, so a correct submission passes under real OR mock
 * Piston (`Hello, <name>!`). Also seeds a handful of leaderboard competitors.
 *
 * Re-running is safe: DailyQuestions upsert by releaseDate, each question's test
 * cases are rebuilt, and competitor users/streaks upsert by username. Real user
 * submissions/streaks are never touched.
 */
import {
  CodeLanguage,
  DailyQuestionType,
  istDayKey,
  istDayRangeUtc,
  previousDayKey,
} from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  DailyQuestionModel,
  DailyTestCaseModel,
  UserStreakModel,
} from "../models/challenge.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

const GREETER_STARTER = `import sys

name = sys.stdin.readline().strip() or "world"
print(f"Hello, {name}!")
`;

interface McqSpec {
  type: "MCQ";
  title: string;
  description: string;
  options: string[];
  correctOption: number;
  marks: number;
}
interface CodeSpec {
  type: "CODE";
  title: string;
  description: string;
  marks: number;
  samples: { input: string; expectedOutput: string }[];
  hidden: { input: string; expectedOutput: string }[];
}
type Spec = McqSpec | CodeSpec;

const greet = (name: string): { input: string; expectedOutput: string } => ({
  input: name,
  expectedOutput: `Hello, ${name}!`,
});

const CODE_TODAY: CodeSpec = {
  type: "CODE",
  title: "Greet the visitor",
  description:
    "Read a single name from standard input and print `Hello, <name>!`. " +
    "If the input is empty, greet `world`.",
  marks: 10,
  samples: [greet("Ada"), greet("Alan")],
  hidden: [greet("Grace"), greet("Linus"), greet("Katherine")],
};

const MCQ_TODAY: McqSpec = {
  type: "MCQ",
  title: "Complexity check",
  description:
    "What is the average-case time complexity of a hash table lookup?",
  options: ["O(n)", "O(log n)", "O(1)", "O(n log n)"],
  correctOption: 2,
  marks: 5,
};

// Prior days (not solvable via /today, but populate history + look real).
const HISTORY: Spec[] = [
  {
    type: "MCQ",
    title: "Data structures",
    description: "Which structure gives LIFO ordering?",
    options: ["Queue", "Stack", "Heap", "Graph"],
    correctOption: 1,
    marks: 5,
  },
  {
    type: "CODE",
    title: "Echo a name",
    description: "Print `Hello, <name>!` for the name on stdin.",
    marks: 10,
    samples: [greet("Sam")],
    hidden: [greet("Dev"), greet("Riya")],
  },
  {
    type: "MCQ",
    title: "Big-O basics",
    description: "Binary search on a sorted array is…",
    options: ["O(n)", "O(1)", "O(log n)", "O(n^2)"],
    correctOption: 2,
    marks: 5,
  },
  {
    type: "CODE",
    title: "Greeting redux",
    description: "Print `Hello, <name>!` for the name on stdin.",
    marks: 10,
    samples: [greet("Nam")],
    hidden: [greet("Ola")],
  },
  {
    type: "MCQ",
    title: "Sorting",
    description: "Which sort is stable and O(n log n) worst case?",
    options: ["Quicksort", "Merge sort", "Heapsort", "Selection sort"],
    correctOption: 1,
    marks: 5,
  },
];

const COMPETITORS = [
  {
    username: "streaker_neo",
    fullName: "Neo Anderson",
    totalScore: 120,
    currentStreak: 12,
    maxStreak: 12,
  },
  {
    username: "algo_trinity",
    fullName: "Trinity Moss",
    totalScore: 95,
    currentStreak: 8,
    maxStreak: 10,
  },
  {
    username: "byte_morpheus",
    fullName: "Morpheus Locke",
    totalScore: 80,
    currentStreak: 5,
    maxStreak: 9,
  },
  {
    username: "loop_switch",
    fullName: "Switch Kelly",
    totalScore: 55,
    currentStreak: 3,
    maxStreak: 6,
  },
  {
    username: "recur_dozer",
    fullName: "Dozer Hass",
    totalScore: 30,
    currentStreak: 2,
    maxStreak: 4,
  },
];

async function upsertQuestion(dayKey: string, spec: Spec): Promise<void> {
  const releaseDate = istDayRangeUtc(dayKey).start;
  const common = {
    title: spec.title,
    description: spec.description,
    marks: spec.marks,
    releaseDate,
  };

  const set =
    spec.type === "MCQ"
      ? {
          ...common,
          questionType: DailyQuestionType.MCQ,
          options: spec.options,
          correctOption: spec.correctOption,
          starterCode: "",
          language: CodeLanguage.PYTHON,
        }
      : {
          ...common,
          questionType: DailyQuestionType.CODE,
          options: undefined,
          correctOption: undefined,
          starterCode: GREETER_STARTER,
          language: CodeLanguage.PYTHON,
        };

  const question = await DailyQuestionModel.findOneAndUpdate(
    { releaseDate },
    { $set: set },
    { upsert: true, new: true },
  );

  // Rebuild test cases for CODE questions.
  await DailyTestCaseModel.deleteMany({ question: question._id });
  if (spec.type === "CODE") {
    await DailyTestCaseModel.insertMany([
      ...spec.samples.map((c) => ({
        question: question._id,
        inputData: c.input,
        expectedOutput: c.expectedOutput,
        isHidden: false,
      })),
      ...spec.hidden.map((c) => ({
        question: question._id,
        inputData: c.input,
        expectedOutput: c.expectedOutput,
        isHidden: true,
      })),
    ]);
  }
}

async function seedChallenges(): Promise<void> {
  await connectDatabase();
  try {
    const todayType = (process.argv[2] ?? "code").toLowerCase();
    const today = istDayKey(new Date());
    const todaySpec: Spec = todayType === "mcq" ? MCQ_TODAY : CODE_TODAY;

    await upsertQuestion(today, todaySpec);

    let day = today;
    for (const spec of HISTORY) {
      day = previousDayKey(day);
      await upsertQuestion(day, spec);
    }

    // Leaderboard competitors (idempotent by username; disabled logins).
    for (const c of COMPETITORS) {
      const user = await UserModel.findOneAndUpdate(
        { username: c.username },
        {
          $setOnInsert: {
            email: `${c.username}@codeapt.demo`,
            passwordHash: "seed-disabled-no-login",
            isActive: true,
          },
        },
        { upsert: true, new: true },
      );
      await ProfileModel.findOneAndUpdate(
        { user: user._id },
        {
          $set: { fullName: c.fullName },
          $setOnInsert: { rollNumber: `SEED-${c.username}` },
        },
        { upsert: true },
      );
      await UserStreakModel.findOneAndUpdate(
        { user: user._id },
        {
          $set: {
            totalScore: c.totalScore,
            currentStreak: c.currentStreak,
            maxStreak: c.maxStreak,
          },
        },
        { upsert: true },
      );
    }

    logger.info(
      `Challenges seeded: today (${today}) = ${todaySpec.type}, ` +
        `${HISTORY.length} prior days, ${COMPETITORS.length} competitors`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedChallenges()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:challenges failed");
    process.exit(1);
  });
