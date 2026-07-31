/**
 * AttendanceSession + AttendanceRecord (Prompt 2) — the dated/timed occurrences
 * of a Prompt-1 AttendanceGroup and the per-student present/absent marks. This
 * is exactly the forward relationship the group model documented: a group has
 * MANY sessions (`session.group`), a session has MANY records
 * (`record.session` + `record.student`).
 *
 * Tenancy: both carry `college` and are ALWAYS queried through the tenant scope.
 *
 * Simultaneity: there is deliberately NO uniqueness on (college, scheduledAt) —
 * two DIFFERENT groups may hold sessions at the same date/time with no conflict.
 * The only uniqueness is one RECORD per (session, student).
 */
import {
  ATTENDANCE_RECORD_STATUS_VALUES,
  ATTENDANCE_SESSION_STATUS_VALUES,
  AttendanceSessionStatus,
} from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

const attendanceSessionSchema = new Schema(
  {
    college: {
      type: Schema.Types.ObjectId,
      ref: "College",
      required: true,
    },
    group: {
      type: Schema.Types.ObjectId,
      ref: "AttendanceGroup",
      required: true,
    },
    title: { type: String, default: "", trim: true },
    /** The occurrence's date + time (scheduled ahead, or "now" for ad-hoc). */
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ATTENDANCE_SESSION_STATUS_VALUES,
      default: AttendanceSessionStatus.SCHEDULED,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Who recorded attendance + when (set on the first save → completed). */
    takenBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    takenAt: { type: Date, default: null },
  },
  { timestamps: true },
);
attendanceSessionSchema.index({ college: 1, group: 1 });
attendanceSessionSchema.index({ college: 1, scheduledAt: 1 });

const attendanceRecordSchema = new Schema(
  {
    college: {
      type: Schema.Types.ObjectId,
      ref: "College",
      required: true,
    },
    session: {
      type: Schema.Types.ObjectId,
      ref: "AttendanceSession",
      required: true,
    },
    student: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ATTENDANCE_RECORD_STATUS_VALUES,
      required: true,
    },
    markedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
// One record per student per session (the save upsert key).
attendanceRecordSchema.index({ session: 1, student: 1 }, { unique: true });
// Prompt-3 student view: "all my records across sessions", tenant-scoped.
attendanceRecordSchema.index({ college: 1, student: 1 });

export type AttendanceSessionDoc = InferSchemaType<typeof attendanceSessionSchema>;
export type AttendanceRecordDoc = InferSchemaType<typeof attendanceRecordSchema>;

export const AttendanceSessionModel = model(
  "AttendanceSession",
  attendanceSessionSchema,
);
export const AttendanceRecordModel = model(
  "AttendanceRecord",
  attendanceRecordSchema,
);
