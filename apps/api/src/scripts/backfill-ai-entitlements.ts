/**
 * One-off, idempotent backfill for the re-homed per-college AI entitlements.
 *
 *   pnpm --filter @codeapt/api backfill:ai-entitlements
 *
 * Prompt 3 introduced a unified `ai` FEATURE with two sub-capabilities:
 *   - `ai.essay_grading`      — AI-assisted essay scoring (was the display-only,
 *                               never-enforced `essays.ai_grading` toggle).
 *   - `ai.question_generation`— AI Test Builder (previously implied by `exams`).
 *
 * To preserve what colleges can do TODAY, this grants:
 *   - `ai` + `ai.essay_grading`       to every college with `essays` enabled,
 *   - `ai` + `ai.question_generation` to every college with `exams`  enabled.
 * New colleges default OFF — a super-admin turns AI on per college. Safe to run
 * repeatedly (setEntitlements just re-sets the same booleans).
 */
import { CollegeFeature } from "@codeapt/shared";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { CollegeModel } from "../models/college.model.js";
import { normalizeEntitlements, setEntitlements } from "../services/college.service.js";

async function backfill(): Promise<void> {
  await connectDatabase();
  try {
    const colleges = await CollegeModel.find();
    let touched = 0;
    for (const college of colleges) {
      const ent = normalizeEntitlements(college);
      const hasEssays = ent.features[CollegeFeature.ESSAYS] === true;
      const hasExams = ent.features[CollegeFeature.EXAMS] === true;
      if (!hasEssays && !hasExams) continue;

      const subCapabilities: Record<string, boolean> = {};
      if (hasEssays) subCapabilities["ai.essay_grading"] = true;
      if (hasExams) subCapabilities["ai.question_generation"] = true;

      await setEntitlements(college._id.toString(), {
        features: { [CollegeFeature.AI]: true },
        subCapabilities,
      });
      touched += 1;
      logger.info(
        { college: college.name, granted: Object.keys(subCapabilities) },
        "AI entitlements backfilled",
      );
    }
    logger.info(
      `AI entitlement backfill complete: ${touched}/${colleges.length} colleges updated.`,
    );
  } finally {
    await disconnectDatabase();
  }
}

backfill()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "backfill:ai-entitlements failed");
    process.exit(1);
  });
