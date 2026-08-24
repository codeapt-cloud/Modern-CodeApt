/**
 * Idempotent gaming seed — NEW in Step 18 (the game module had no seed script;
 * game sets were only ever authored through the admin API). Seeds a demo college
 * with a published set that leads with the new grid_challenge, so the seventh game
 * is click-through playable end to end.
 *
 *   pnpm --filter @codeapt/api seed:games
 *
 * Upserts a "Gaming Demo" college (slug `game-demo`) with the `gaming` feature,
 * a published set "Capgemini Aptitude — Grid Challenge" (grid_challenge +
 * bubble_math + geo_sudo), and a demo student. Re-runnable: college upserts by
 * slug, the set by (college, title).
 *
 * Click-through: sign in as the demo student → /c/game-demo → the game set →
 * play grid_challenge (memorise the green circle 2s, judge the rotation 6s, ×3,
 * then recall in order; +3/-1 live score).
 */
import {
  GameDifficulty,
  GameKey,
  Role,
  UserType,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { CollegeModel } from "../models/college.model.js";
import { GameSetModel } from "../models/game.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";
import { setEntitlements } from "../services/college.service.js";

const SLUG = "game-demo";
const SET_TITLE = "Capgemini Aptitude — Grid Challenge";
const DEMO_STUDENT_EMAIL = "game.student@game-demo.test";
const DEMO_STUDENT_PASSWORD = "GameDemo@123";

async function seedGames(): Promise<void> {
  await connectDatabase();
  try {
    const college = await CollegeModel.findOneAndUpdate(
      { slug: SLUG },
      {
        $setOnInsert: {
          name: "Gaming Demo",
          slug: SLUG,
          createdBy: new Types.ObjectId(), // seed-only placeholder creator
        },
      },
      { upsert: true, new: true },
    );
    await setEntitlements(college._id.toString(), { features: { gaming: true } });

    const games = [
      {
        gameKey: GameKey.GRID_CHALLENGE,
        order: 0,
        durationSeconds: 240,
        allowSkip: false,
        startingDifficulty: GameDifficulty.EASY,
        // ONE composite item (3 internal cycles + recall). maxQuestions>1 would
        // RE-SERVE the whole game — it is not "3 questions".
        maxQuestions: 1,
      },
      {
        gameKey: GameKey.BUBBLE_MATH,
        order: 1,
        durationSeconds: 120,
        allowSkip: true,
        startingDifficulty: GameDifficulty.EASY,
        maxQuestions: 5,
      },
      {
        gameKey: GameKey.GEO_SUDO,
        order: 2,
        durationSeconds: 180,
        allowSkip: true,
        startingDifficulty: GameDifficulty.EASY,
        maxQuestions: 5,
      },
    ];

    const set = await GameSetModel.findOneAndUpdate(
      { college: college._id, title: SET_TITLE },
      {
        $set: {
          orgUnits: [],
          isPublished: true,
          selectionMode: "fixed",
          instantFeedback: true, // practice reveal on, so `explain` is available
          maxAttempts: 0, // unlimited for a demo
          games,
        },
      },
      { upsert: true, new: true },
    );

    let student = await UserModel.findOne({ email: DEMO_STUDENT_EMAIL });
    if (!student) {
      student = await UserModel.create({
        username: "game-demo-student",
        email: DEMO_STUDENT_EMAIL,
        passwordHash: await hashPassword(DEMO_STUDENT_PASSWORD),
        role: Role.STUDENT,
        userType: UserType.COLLEGE,
        college: college._id,
        forcePasswordChange: false,
      });
      await ProfileModel.create({
        user: student._id,
        fullName: "Gaming Demo Student",
        rollNumber: "GAME-0001",
        avatarUrl: "https://ui-avatars.com/api/?name=Game+Student&background=random",
      });
    } else {
      student.college = college._id;
      student.role = Role.STUDENT;
      student.userType = UserType.COLLEGE;
      student.forcePasswordChange = false;
      student.passwordHash = await hashPassword(DEMO_STUDENT_PASSWORD);
      await student.save();
    }

    logger.info(
      `Games seeded: college "${SLUG}", set "${set.title}" ` +
        `(${games.length} games, leading with grid_challenge), published. ` +
        `Demo student ${DEMO_STUDENT_EMAIL} / ${DEMO_STUDENT_PASSWORD}.`,
    );
  } finally {
    await disconnectDatabase();
  }
}

seedGames()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:games failed");
    process.exit(1);
  });
