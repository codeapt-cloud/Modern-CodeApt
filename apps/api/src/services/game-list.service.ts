/**
 * Lists the COURSE-ATTACHED game sets a student can play: sets whose curriculum
 * Topic (type `game`) sits in a subject the user is enrolled in. A DIRECT mirror
 * of listExamsForUser (exam-list.service) — same Enrollment→Subject→Module→
 * Topic→(entity) chain, differing only in topicType (GAME) and the entity
 * (GameSet by its `topic` FK). Each item carries `topicId` so the learn player
 * can match it to the game topic in the course tree, exactly as exams do.
 *
 * Enrollment-based DISCOVERY, deliberately: a B2C learner and a college student
 * assigned the course both hold an Enrollment, so both see the set here. (Play
 * AUTHORIZATION for a college student is the looser grant-based rule in
 * assertCanPlayGameSet — see that function.)
 */
import { TopicType, type GamePlayListResponse } from "@codeapt/shared";

import {
  EnrollmentModel,
  ModuleModel,
  TopicModel,
} from "../models/curriculum.model.js";
import { GameSetModel } from "../models/game.model.js";
import { countUsedAttempts } from "./game.service.js";
import { toGamePlayListItem } from "./game-set-admin.service.js";

export async function listGamesForUser(
  userId: string,
): Promise<GamePlayListResponse> {
  const enrollments = await EnrollmentModel.find({ user: userId }).select(
    "subject",
  );
  const subjectIds = enrollments.map((e) => e.subject);
  if (subjectIds.length === 0) return { items: [] };

  const modules = await ModuleModel.find({
    subject: { $in: subjectIds },
  }).select("_id");
  const gameTopics = await TopicModel.find({
    module: { $in: modules.map((m) => m._id) },
    topicType: TopicType.GAME,
  }).select("_id");
  const topicIds = gameTopics.map((t) => t._id);
  if (topicIds.length === 0) return { items: [] };

  const sets = await GameSetModel.find({ topic: { $in: topicIds } });
  const items = [];
  for (const set of sets) {
    const used = await countUsedAttempts(userId, set._id);
    items.push(toGamePlayListItem(set, used));
  }
  return { items };
}
