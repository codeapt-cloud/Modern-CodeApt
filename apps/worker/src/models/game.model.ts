/**
 * Minimal worker copy of the GameSetAttempt collection — ONLY what the shared
 * attempt reaper needs to sweep abandoned game plays. Maps onto the same
 * `gamesetattempts` collection the API writes; indexes are owned by the API copy.
 * (The API game model has much more; the reaper only reads status + updatedAt and
 * writes a terminal status, so this deliberately stays tiny.)
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import { GAME_SET_ATTEMPT_STATUS_VALUES, GameSetAttemptStatus } from "@codeapt/shared";

const gameSetAttemptSchema = new Schema(
  {
    status: {
      type: String,
      enum: GAME_SET_ATTEMPT_STATUS_VALUES,
      default: GameSetAttemptStatus.IN_PROGRESS,
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "gamesetattempts" },
);
export type GameSetAttempt = InferSchemaType<typeof gameSetAttemptSchema>;
export const GameSetAttemptModel = model(
  "GameSetAttempt",
  gameSetAttemptSchema,
);
