/**
 * Idempotent curriculum seed. Creates a realistic sample catalog:
 * 2 Programs, 5 Subjects (mix of FREE and PAID, some popular), Modules, and
 * Topics of each content type (markdown text, YouTube video, and a graded
 * quiz with Questions + Choices).
 *
 *   pnpm --filter @codeapt/api seed:curriculum
 *
 * Re-running is safe: Programs/Subjects are upserted by slug, and each seeded
 * subject's content tree (modules/topics/questions/choices) is rebuilt fresh.
 * User data (enrollments/progress/submissions) is never touched.
 */
import { TopicType } from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  ChoiceModel,
  ModuleModel,
  ProgramModel,
  QuestionModel,
  SubjectModel,
  TopicModel,
} from "../models/curriculum.model.js";

interface SeedChoice {
  text: string;
  correct?: boolean;
}
interface SeedQuestion {
  text: string;
  marks?: number;
  choices: SeedChoice[];
}
interface SeedTopic {
  name: string;
  type: TopicType;
  order: number;
  duration?: string;
  content?: string;
  videoId?: string;
  questions?: SeedQuestion[];
}
interface SeedModule {
  name: string;
  order: number;
  topics: SeedTopic[];
}
interface SeedSubject {
  slug: string;
  name: string;
  programSlug: string;
  description: string;
  price: number; // paise
  discountPrice: number; // paise
  isPopular: boolean;
  modules: SeedModule[];
}

const PROGRAMS = [
  {
    slug: "placement-foundations",
    name: "Placement Foundations",
    description: "Core aptitude, verbal, and reasoning for campus drives.",
    order: 1,
  },
  {
    slug: "product-track",
    name: "Product Company Track",
    description: "DSA, system design, and problem solving for product roles.",
    order: 2,
  },
];

const quizTopic = (order: number): SeedTopic => ({
  name: "Checkpoint quiz",
  type: TopicType.QUIZ,
  order,
  duration: "10 min",
  questions: [
    {
      text: "What is the time complexity of binary search on a sorted array?",
      marks: 5,
      choices: [
        { text: "O(n)" },
        { text: "O(log n)", correct: true },
        { text: "O(n log n)" },
        { text: "O(1)" },
      ],
    },
    {
      text: "Which data structure uses FIFO ordering?",
      marks: 5,
      choices: [
        { text: "Stack" },
        { text: "Queue", correct: true },
        { text: "Tree" },
        { text: "Graph" },
      ],
    },
    {
      text: "Select the prime numbers.",
      marks: 5,
      choices: [
        { text: "2", correct: true },
        { text: "9" },
        { text: "7", correct: true },
        { text: "15" },
      ],
    },
  ],
});

const SUBJECTS: SeedSubject[] = [
  {
    slug: "aptitude-essentials",
    name: "Aptitude Essentials",
    programSlug: "placement-foundations",
    description:
      "Master quantitative aptitude: numbers, percentages, time & work, and probability — the backbone of every placement test.",
    price: 0,
    discountPrice: 0,
    isPopular: true,
    modules: [
      {
        name: "Numbers & Arithmetic",
        order: 1,
        topics: [
          {
            name: "Number systems",
            type: TopicType.TEXT,
            order: 1,
            duration: "8 min",
            content:
              "# Number systems\n\nEvery aptitude test starts here. We cover **natural**, **whole**, **integer**, and **rational** numbers, divisibility rules, and remainders.\n\n- Divisibility by 3: digit sum divisible by 3\n- Divisibility by 11: alternating digit sum",
          },
          {
            name: "Percentages (video)",
            type: TopicType.VIDEO,
            order: 2,
            duration: "12 min",
            videoId: "rfscVS0vtbw",
          },
          quizTopic(3),
        ],
      },
      {
        name: "Time, Speed & Work",
        order: 2,
        topics: [
          {
            name: "Time & work basics",
            type: TopicType.TEXT,
            order: 1,
            duration: "10 min",
            content:
              "# Time & Work\n\nIf A does a job in `a` days and B in `b` days, together they take `ab/(a+b)` days. Practice the classic pipe-and-cistern variants.",
          },
        ],
      },
    ],
  },
  {
    slug: "verbal-ability",
    name: "Verbal Ability",
    programSlug: "placement-foundations",
    description:
      "Reading comprehension, sentence correction, and vocabulary for the verbal section of aptitude rounds.",
    price: 0,
    discountPrice: 0,
    isPopular: false,
    modules: [
      {
        name: "Grammar foundations",
        order: 1,
        topics: [
          {
            name: "Subject–verb agreement",
            type: TopicType.TEXT,
            order: 1,
            duration: "7 min",
            content:
              "# Subject–verb agreement\n\nThe verb must agree with the subject in number. Watch out for intervening phrases: *The list of items **is** on the desk.*",
          },
          quizTopic(2),
        ],
      },
    ],
  },
  {
    slug: "tcs-nqt-crash-course",
    name: "TCS NQT Crash Course",
    programSlug: "placement-foundations",
    description:
      "A focused, exam-pattern crash course for the TCS National Qualifier Test — numerical, verbal, and programming logic.",
    price: 0,
    discountPrice: 0,
    isPopular: true,
    modules: [
      {
        name: "Exam pattern & strategy",
        order: 1,
        topics: [
          {
            name: "Understanding the NQT",
            type: TopicType.TEXT,
            order: 1,
            duration: "9 min",
            content:
              "# The TCS NQT\n\nSections: Numerical Ability, Verbal Ability, Reasoning Ability, and Programming Logic. Each is section-timed — pace yourself.",
          },
          {
            name: "Programming logic (video)",
            type: TopicType.VIDEO,
            order: 2,
            duration: "15 min",
            videoId: "8hly31xKli0",
          },
        ],
      },
    ],
  },
  {
    slug: "data-structures-cpp",
    name: "Data Structures in C++",
    programSlug: "product-track",
    description:
      "Arrays, linked lists, trees, heaps, and graphs implemented in modern C++ — with complexity analysis and interview patterns.",
    price: 129900,
    discountPrice: 99900,
    isPopular: true,
    modules: [
      {
        name: "Linear structures",
        order: 1,
        topics: [
          {
            name: "Arrays & dynamic arrays",
            type: TopicType.TEXT,
            order: 1,
            duration: "14 min",
            content:
              "# Arrays\n\nContiguous memory, O(1) random access, O(n) insert/delete. `std::vector` amortizes push_back to O(1).",
          },
          {
            name: "Linked lists (video)",
            type: TopicType.VIDEO,
            order: 2,
            duration: "18 min",
            videoId: "rfscVS0vtbw",
          },
          quizTopic(3),
        ],
      },
      {
        name: "Trees & graphs",
        order: 2,
        topics: [
          {
            name: "Binary trees & traversals",
            type: TopicType.TEXT,
            order: 1,
            duration: "16 min",
            content:
              "# Binary trees\n\nIn-order, pre-order, post-order, and level-order traversals. BSTs give O(log n) search when balanced.",
          },
        ],
      },
    ],
  },
  {
    slug: "system-design-primer",
    name: "System Design Primer",
    programSlug: "product-track",
    description:
      "Scalable system design fundamentals — load balancing, caching, sharding, and designing real systems for interviews.",
    price: 199900,
    discountPrice: 0,
    isPopular: false,
    modules: [
      {
        name: "Scaling fundamentals",
        order: 1,
        topics: [
          {
            name: "Vertical vs horizontal scaling",
            type: TopicType.TEXT,
            order: 1,
            duration: "11 min",
            content:
              "# Scaling\n\n**Vertical**: bigger machines. **Horizontal**: more machines behind a load balancer. Horizontal wins for availability.",
          },
        ],
      },
    ],
  },
];

async function seedCurriculum(): Promise<void> {
  await connectDatabase();
  try {
    // Upsert programs, keep a slug -> id map.
    const programIds = new Map<string, unknown>();
    for (const p of PROGRAMS) {
      const doc = await ProgramModel.findOneAndUpdate(
        { slug: p.slug },
        {
          $set: {
            name: p.name,
            description: p.description,
            order: p.order,
            isVisible: true,
          },
        },
        { upsert: true, new: true },
      );
      programIds.set(p.slug, doc._id);
    }

    for (const s of SUBJECTS) {
      const subject = await SubjectModel.findOneAndUpdate(
        { slug: s.slug },
        {
          $set: {
            name: s.name,
            program: programIds.get(s.programSlug),
            description: s.description,
            price: s.price,
            discountPrice: s.discountPrice,
            isPopular: s.isPopular,
            isVisible: true,
          },
        },
        { upsert: true, new: true },
      );

      // Rebuild the content tree for a deterministic, duplicate-free seed.
      const existingModules = await ModuleModel.find({
        subject: subject._id,
      }).select("_id");
      const moduleIds = existingModules.map((m) => m._id);
      const existingTopics = await TopicModel.find({
        module: { $in: moduleIds },
      }).select("_id");
      const topicIds = existingTopics.map((t) => t._id);
      const existingQuestions = await QuestionModel.find({
        topic: { $in: topicIds },
      }).select("_id");
      await ChoiceModel.deleteMany({
        question: { $in: existingQuestions.map((q) => q._id) },
      });
      await QuestionModel.deleteMany({ topic: { $in: topicIds } });
      await TopicModel.deleteMany({ module: { $in: moduleIds } });
      await ModuleModel.deleteMany({ subject: subject._id });

      for (const m of s.modules) {
        const module = await ModuleModel.create({
          subject: subject._id,
          name: m.name,
          order: m.order,
        });
        for (const t of m.topics) {
          const topic = await TopicModel.create({
            module: module._id,
            name: t.name,
            topicType: t.type,
            order: t.order,
            content: t.content ?? "",
            videoId: t.videoId ?? "",
            duration: t.duration ?? "",
            isVisible: true,
          });
          if (t.questions) {
            for (const q of t.questions) {
              const question = await QuestionModel.create({
                subject: subject._id,
                topic: topic._id,
                text: q.text,
                marks: q.marks ?? 5,
              });
              await ChoiceModel.insertMany(
                q.choices.map((c) => ({
                  question: question._id,
                  text: c.text,
                  isCorrect: Boolean(c.correct),
                })),
              );
            }
          }
        }
      }
      logger.info(`Seeded subject "${s.name}" (${s.slug})`);
    }

    logger.info(
      `Curriculum seed complete: ${PROGRAMS.length} programs, ${SUBJECTS.length} subjects`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedCurriculum()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:curriculum failed");
    process.exit(1);
  });
