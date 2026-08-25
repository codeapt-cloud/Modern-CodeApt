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
import {
  buildItemsFromPreset,
  Role,
  SPEAKING_PRESETS,
  speakingItemNeedsAudio,
  speakingPromptAudioText,
  speakingStimulusAudioText,
  UserType,
} from "@codeapt/shared";
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
      promptAudioText: "", // presets don't override; authored per-item in the editor
      promptAudioUrl: spec.promptAudioUrl ?? "",
      stimulusText: spec.stimulusText ?? "",
      stimulusAudioUrl: spec.stimulusAudioUrl ?? "",
      stimulusPlayLimit: spec.stimulusPlayLimit ?? 0,
      answerSet: spec.answerSet ? [...spec.answerSet] : [],
      missingWord: spec.missingWord ?? "",
      keyFacts: spec.keyFacts ? [...spec.keyFacts] : [],
      chunks: spec.chunks ? [...spec.chunks] : [],
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
          // Publish is DECIDED below, after the audio pass — a listen item with
          // no audio must not ship published (Step 27).
          isPublished: false,
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
    // Which items NEED audio comes from the shared predicate (one source of
    // truth with the runner + publish guard) — NOT a hand-kept list. This fixes
    // two prior bugs: sentence_build was being synthesised (it would have played
    // the ANSWER) and story_retell was being skipped (it needs the narration).
    let generated = 0;
    let skipped = 0;
    for (let i = 0; i < doc.items.length; i += 1) {
      const it = doc.items[i]!;
      if (!speakingItemNeedsAudio({ itemType: it.itemType, chunks: it.chunks })) {
        continue;
      }
      // TWO independent audio slots, matching the authoring rule:
      //   - STIMULUS: the sentence/dialogue/passage the student HEARS but never
      //     sees (repeat sentence, gapped/erroneous sentence, dialogue, passage,
      //     narration). Authored as stimulusText; the runner plays it FIRST.
      //   - PROMPT: the on-screen prompt/instruction (or sentence_build chunks).
      // referenceText is NEVER spoken — it is the answer key for verification.
      // Generate the stimulus when one is authored, otherwise the prompt clip;
      // either satisfies the publish guard and gives the item something to hear.
      const stimulusText = speakingStimulusAudioText({ stimulusText: it.stimulusText });
      const promptText = speakingPromptAudioText({
        itemType: it.itemType,
        promptText: it.promptText,
        promptAudioText: it.promptAudioText,
        chunks: it.chunks,
      });
      try {
        if (stimulusText && !it.stimulusAudioUrl) {
          const tts = await generateSpeakingPromptAudio(collegeId, stimulusText);
          it.stimulusAudioUrl = tts.audioUrl;
          it.stimulusAudioVoiceId = tts.voiceId;
          it.stimulusAudioVoiceVersion = tts.voiceVersion;
          generated += 1;
        } else if (!stimulusText && promptText && !it.promptAudioUrl) {
          const tts = await generateSpeakingPromptAudio(collegeId, promptText);
          it.promptAudioUrl = tts.audioUrl;
          it.promptAudioVoiceId = tts.voiceId;
          it.promptAudioVoiceVersion = tts.voiceVersion;
          generated += 1;
        }
      } catch (err) {
        skipped += 1;
        logger.warn(
          { itemType: it.itemType, err: (err as Error).message },
          "seed:speaking — audio skipped (TTS/Cloudinary unavailable); text kept",
        );
      }
    }

    // Decide publish HONESTLY: a listen item still missing audio makes the paper
    // unplayable, so it stays DRAFT with a loud, actionable message — never a
    // published-but-broken paper (Step 27 / matches the new publish guard).
    const missing = doc.items
      .map((it, idx) => ({ it, idx }))
      .filter(
        ({ it }) =>
          speakingItemNeedsAudio({ itemType: it.itemType, chunks: it.chunks }) &&
          !it.promptAudioUrl &&
          !it.stimulusAudioUrl,
      );
    doc.isPublished = missing.length === 0;
    doc.markModified("items");
    await doc.save();

    if (missing.length === 0) {
      logger.info(
        { generated, skipped },
        "seed:speaking — all listen items have audio; assessment PUBLISHED and fully playable",
      );
    } else {
      logger.warn(
        {
          missing: missing.map((m) => ({ index: m.idx + 1, itemType: m.it.itemType })),
        },
        "seed:speaking — LEFT DRAFT: some listen items have no audio, so the paper " +
          "is not playable end to end. To fix: set CLOUDINARY_URL (or CLOUDINARY_* " +
          "cloud/key/secret) AND rebuild the ASR image with Piper enabled, then re-run " +
          "`pnpm --filter @codeapt/api seed:speaking`; or attach audio per item in the " +
          "editor and publish. Until then the composite's speaking part stays unpublished.",
      );
    }

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
        `(${items.length} items across ${new Set(items.map((i) => i.section)).size} sections), ` +
        `${doc.isPublished ? "PUBLISHED" : "DRAFT (see the audio warning above)"}. ` +
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
