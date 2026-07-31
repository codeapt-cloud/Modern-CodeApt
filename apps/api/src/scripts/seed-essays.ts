/**
 * Idempotent essay seed.
 *
 *   pnpm --filter @codeapt/api seed:essays
 *
 * Creates a FREE "Writing & Communication" subject with two `essay`-type
 * Topics, each linked 1:1 to an EssayTopic prompt carrying a title, prompt
 * text, instructions, ADMIN-only reference keywords (`semanticKeywords`), and
 * min/max word bounds. Re-runnable: the curriculum tree and prompts upsert by
 * slug/name, and each Topic is (re)linked to its EssayTopic.
 */
import { TopicType } from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  ModuleModel,
  ProgramModel,
  SubjectModel,
  TopicModel,
} from "../models/curriculum.model.js";
import { EssayTopicModel } from "../models/essay.model.js";

interface PromptSeed {
  topicName: string;
  order: number;
  title: string;
  description: string;
  instructions: string;
  difficultyLevel: 1 | 2 | 3;
  minWords: number;
  maxWords: number;
  timeLimitMinutes: number;
  semanticKeywords: string[];
}

const PROMPTS: PromptSeed[] = [
  {
    topicName: "The Impact of Technology",
    order: 1,
    title: "The Impact of Technology on Modern Education",
    description:
      "Discuss how digital technology has reshaped teaching and learning.",
    instructions:
      "Write a well-structured essay. Include an introduction, at least two " +
      "body paragraphs with concrete examples, and a conclusion.",
    difficultyLevel: 2,
    minWords: 120,
    maxWords: 600,
    timeLimitMinutes: 30,
    // ADMIN-only — the relevance analyzer measures coverage of these.
    semanticKeywords: [
      "technology",
      "education",
      "learning",
      "students",
      "digital",
      "classroom",
      "online",
      "access",
      "skills",
      "future",
    ],
  },
  {
    topicName: "Remote Work",
    order: 2,
    title: "Is Remote Work the Future of Employment?",
    description:
      "Argue for or against remote work becoming the dominant model.",
    instructions:
      "Take a clear position and defend it with reasons and examples. Use " +
      "transitions to connect your paragraphs.",
    difficultyLevel: 2,
    minWords: 150,
    maxWords: 700,
    timeLimitMinutes: 40,
    semanticKeywords: [
      "remote",
      "work",
      "employees",
      "productivity",
      "office",
      "flexibility",
      "collaboration",
      "communication",
      "balance",
      "company",
    ],
  },
];

async function seedEssays(): Promise<void> {
  await connectDatabase();
  try {
    const program = await ProgramModel.findOneAndUpdate(
      { slug: "communication" },
      { $set: { name: "Communication", isVisible: true, order: 10 } },
      { upsert: true, new: true },
    );
    const subject = await SubjectModel.findOneAndUpdate(
      { slug: "writing-essays" },
      {
        $set: {
          name: "Writing & Communication",
          program: program._id,
          description: "AI-graded essay practice with instant feedback.",
          price: 0,
          discountPrice: 0,
          isVisible: true,
        },
      },
      { upsert: true, new: true },
    );
    const mod = await ModuleModel.findOneAndUpdate(
      { subject: subject._id, name: "Essay Prompts" },
      { $set: { order: 1 } },
      { upsert: true, new: true },
    );

    for (const p of PROMPTS) {
      // Upsert the EssayTopic prompt (keyed by title).
      const prompt = await EssayTopicModel.findOneAndUpdate(
        { title: p.title },
        {
          $set: {
            description: p.description,
            instructions: p.instructions,
            difficultyLevel: p.difficultyLevel,
            minWords: p.minWords,
            maxWords: p.maxWords,
            timeLimitMinutes: p.timeLimitMinutes,
            isActive: true,
            semanticKeywords: p.semanticKeywords,
          },
        },
        { upsert: true, new: true },
      );

      // Link an `essay`-type curriculum Topic to it (1:1).
      await TopicModel.findOneAndUpdate(
        { module: mod._id, name: p.topicName },
        {
          $set: {
            topicType: TopicType.ESSAY,
            order: p.order,
            isVisible: true,
            essayTopic: prompt._id,
          },
        },
        { upsert: true, new: true },
      );
    }

    logger.info(
      `Essays seeded: subject "${subject.name}" (slug ${subject.slug}) ` +
        `with ${PROMPTS.length} prompts.`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedEssays()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:essays failed");
    process.exit(1);
  });
