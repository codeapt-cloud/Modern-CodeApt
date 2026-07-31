/**
 * AttendanceGroup (Prompt 1) — a tenant-scoped, named set of students: a
 * recurring "class" or a one-off "event" (identical structure). Membership is
 * stored as the RESOLVED set of member students PLUS the PROVENANCE of how each
 * was added (source + the org-unit ref for unit-based adds) so a group stays
 * editable / re-resolvable. Assembled from any mix of org-units, sections,
 * individuals, and an Excel roll-number upload, de-duplicated to one membership
 * per student (see @codeapt/shared dedupeMembers).
 *
 * Tenancy: every read/write goes through createTenantScope(collegeId) — a group
 * can never cross a tenant boundary. Faculty scope + the college's cross-cutting
 * permission are enforced in the service.
 *
 * FORWARD RELATIONSHIP (Prompt 2 — sessions + records, NOT modeled here): a
 * group has MANY AttendanceSessions (one per meeting/date, `session.group` →
 * this._id), and a session has MANY present/absent AttendanceRecords
 * (`record.session` + `record.student`). Prompt 2 adds those collections; they
 * reference `AttendanceGroup._id` and its `members`, so this model is the anchor
 * — no session logic lives here.
 */
import {
  ATTENDANCE_GROUP_KIND_VALUES,
  ATTENDANCE_MEMBER_SOURCE_VALUES,
  AttendanceGroupKind,
} from "@codeapt/shared";
import { Schema, model, type InferSchemaType } from "mongoose";

// A single resolved membership + how it was added (no own _id — owned by the group).
const memberSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: ATTENDANCE_MEMBER_SOURCE_VALUES, required: true },
    /** Org-unit id for org_unit/section sources; null for individual/excel. */
    sourceRef: { type: Schema.Types.ObjectId, ref: "OrgUnit", default: null },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const attendanceGroupSchema = new Schema(
  {
    college: {
      type: Schema.Types.ObjectId,
      ref: "College",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    kind: {
      type: String,
      enum: ATTENDANCE_GROUP_KIND_VALUES,
      default: AttendanceGroupKind.CLASS,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Faculty who may take this group's attendance (Prompt 2). */
    facultyOwners: [{ type: Schema.Types.ObjectId, ref: "User" }],
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true },
);

// A group name is unique WITHIN a college (case-as-stored). Tenant-scoped reads
// pair with this so two colleges may reuse the same group name.
attendanceGroupSchema.index({ college: 1, name: 1 }, { unique: true });
// Student view (Prompt 3): "which groups is this student in?" — tenant-scoped.
attendanceGroupSchema.index({ college: 1, "members.student": 1 });

export type AttendanceGroupDoc = InferSchemaType<typeof attendanceGroupSchema>;
export const AttendanceGroupModel = model(
  "AttendanceGroup",
  attendanceGroupSchema,
);
