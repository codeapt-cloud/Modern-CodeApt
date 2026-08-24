/**
 * Idempotent speaking-assessment seed.
 *
 *   pnpm --filter @codeapt/api seed:speaking
 *
 * Upserts a demo college ("Communication Demo", slug `comm-demo`) with the
 * communication feature + speaking sub-capability enabled, and attaches ONE
 * published assessment built from the CTS preset (buildItemsFromPreset("cts")) —
 * a full Section A item mix + Section B speaking topics. Re-runnable: the college
 * upserts by slug and the assessment's items are rebuilt from the preset.
 *
 * Click-through after seeding:
 *   1. Sign in as a member of the `comm-demo` college (create a student via the
 *      college admin, or point an existing member's college at comm-demo).
 *   2. Open /c/comm-demo/communication → the Speaking card → the "CTS ..." paper.
 *   3. Start the attempt: read_aloud shows its text; every other item withholds
 *      its reference; dictation is typed (scored inline); story_retell/open_topic
 *      score on the deterministic floor unless the LLM gateway is configured.
 */
import { buildItemsFromPreset, Role, SPEAKING_PRESETS, UserType } from "@codeapt/shared";
import { Types } from "mongoose";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { CollegeModel } from "../models/college.model.js";
import { SpeakingAssessmentModel } from "../models/speaking.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { setEntitlements } from "../services/college.service.js";
import { generateSpeakingPromptAudio } from "../services/speaking.service.js";

const SLUG = "comm-demo";
const DEMO_STUDENT_EMAIL = "comm.student@comm-demo.test";
const DEMO_STUDENT_PASSWORD = "CommDemo@123";

async function seedSpeaking(): Promise<void> {
  await connectDatabase();
  try {
    // 1. Upsert the demo college.
    const college = await CollegeModel.findOneAndUpdate(
      { slug: SLUG },
      {
        $setOnInsert: {
          name: "Communication Demo",
          slug: SLUG,
          createdBy: new Types.ObjectId(), // seed-only placeholder creator
        },
      },
      { upsert: true, new: true },
    );
    const collegeId = college._id.toString();

    // 2. Enable communication + the speaking sub-capability.
    await setEntitlements(collegeId, { features: { communication: true } });
    await setEntitlements(collegeId, {
      subCapabilities: { "communication.speaking": true },
    });

    // 3. Rebuild the CTS-preset assessment (idempotent by college + title).
    const preset = SPEAKING_PRESETS.cts!;
    const items = buildItemsFromPreset("cts").map((spec, order) => ({
      itemType: spec.itemType,
      referenceText: spec.referenceText ?? "",
      promptText: spec.promptText ?? "",
      promptAudioUrl: spec.promptAudioUrl ?? "",
      stimulusAudioUrl: spec.stimulusAudioUrl ?? "",
      stimulusPlayLimit: spec.stimulusPlayLimit ?? 0,
      answerSet: spec.answerSet ? [...spec.answerSet] : [],
      missingWord: spec.missingWord ?? "",
      keyFacts: spec.keyFacts ? [...spec.keyFacts] : [],
      section: spec.section,
      prepSeconds: spec.prepSeconds ?? 0,
      responseWindowSeconds: spec.responseWindowSeconds ?? 60,
      order,
    }));

    const doc = await SpeakingAssessmentModel.findOneAndUpdate(
      { college: college._id, title: preset.name },
      {
        $set: {
          topic: null,
          orgUnits: [],
          isPublished: true,
          description: preset.description,
          items,
          maxAttempts: 0, // unlimited for a demo
        },
      },
      { upsert: true, new: true },
    );

    // 3b. Generate prompt AUDIO for the listen-based items via the Step-19 TTS
    // pipeline (server-side Piper → Cloudinary), pinning the fixed voice on each
    // item. This is also the proof that Part A works at realistic volume. It is
    // BEST-EFFORT: when the ASR/TTS container or Cloudinary is not configured
    // (e.g. an offline content-only seed), each item logs a skip and keeps its
    // text — the paper is still fully seeded. read_aloud / open_topic show their
    // text on screen, so they need no spoken prompt.
    const HEARD = new Set([
      "repeat",
      "dictation",
      "sentence_build",
      "error_correct",
      "fill_missing_word",
      "short_answer",
      "conversation",
      "passage_question",
    ]);
    let generated = 0;
    let skipped = 0;
    for (let i = 0; i < doc.items.length; i += 1) {
      const it = doc.items[i]!;
      if (!HEARD.has(it.itemType) || it.promptAudioUrl) continue;
      const text = (it.referenceText || it.promptText || "").trim();
      if (!text) continue;
      try {
        const tts = await generateSpeakingPromptAudio(collegeId, text);
        it.promptAudioUrl = tts.audioUrl;
        it.promptAudioVoiceId = tts.voiceId;
        it.promptAudioVoiceVersion = tts.voiceVersion;
        generated += 1;
      } catch (err) {
        skipped += 1;
        logger.warn(
          { itemType: it.itemType, err: (err as Error).message },
          "seed:speaking — prompt audio skipped (TTS/Cloudinary unavailable); text kept",
        );
      }
    }
    if (generated > 0) {
      doc.markModified("items");
      await doc.save();
    }
    logger.info(
      { generated, skipped },
      "seed:speaking — prompt audio generation pass complete",
    );

    // 4. Upsert a demo STUDENT in the college so the paper is reachable.
    let student = await UserModel.findOne({ email: DEMO_STUDENT_EMAIL });
    if (!student) {
      student = await UserModel.create({
        username: "comm-demo-student",
        email: DEMO_STUDENT_EMAIL,
        passwordHash: await hashPassword(DEMO_STUDENT_PASSWORD),
        role: Role.STUDENT,
        userType: UserType.COLLEGE,
        college: college._id,
        forcePasswordChange: false,
      });
      await ProfileModel.create({
        user: student._id,
        fullName: "Communication Demo Student",
        rollNumber: "COMM-0001",
        avatarUrl: `https://ui-avatars.com/api/?name=Comm+Student&background=random`,
      });
    } else {
      // Keep it pointed at this college + a known password on re-seed.
      student.college = college._id;
      student.role = Role.STUDENT;
      student.userType = UserType.COLLEGE;
      student.forcePasswordChange = false;
      student.passwordHash = await hashPassword(DEMO_STUDENT_PASSWORD);
      await student.save();
    }

    logger.info(
      `Speaking seeded: college "${SLUG}", assessment "${doc.title}" ` +
        `(${items.length} items across ${new Set(items.map((i) => i.section)).size} sections), published. ` +
        `Demo student ${DEMO_STUDENT_EMAIL} / ${DEMO_STUDENT_PASSWORD}.`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedSpeaking()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:speaking failed");
    process.exit(1);
  });
