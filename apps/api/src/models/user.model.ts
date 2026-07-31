/**
 * User & Profile.
 *
 * We split auth (User) from profile data (Profile), mirroring Django's
 * User + core.Profile 1-to-1 relationship. `forcePasswordChange` moves onto
 * User because it gates the auth flow (it lived on Profile in Django only
 * because Django's User wasn't extended).
 *
 * References over embedding: Profile is a separate collection so auth reads
 * (hot path) don't drag profile blobs, and so admin can query profiles freely.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import { ROLE_VALUES, Role, USER_TYPE_VALUES, UserType } from "@codeapt/shared";

// Faculty scope — which org-units (dept/year/section/semester, added as the
// OrgUnit model in Phase 2) a faculty member manages. Modelled now, populated
// later; empty for every non-faculty user. No own _id (owned by the user).
const facultyScopeSchema = new Schema(
  {
    orgUnits: [{ type: Schema.Types.ObjectId, ref: "OrgUnit" }],
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    // Login identifier (case preserved); also drives the default avatar.
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLE_VALUES, default: Role.STUDENT },
    // --- Multi-tenant additions (additive; existing users default to the B2C
    // world). `userType` defaults to `individual` so every pre-existing user is
    // an individual learner; `college` is null except for college users. See
    // docs/MULTI_TENANT_ARCHITECTURE.md.
    userType: {
      type: String,
      enum: USER_TYPE_VALUES,
      default: UserType.INDIVIDUAL,
    },
    college: { type: Schema.Types.ObjectId, ref: "College", default: null },
    facultyScope: { type: facultyScopeSchema, default: () => ({ orgUnits: [] }) },
    // --- College-student additions (Phase 3; additive). Set only for college
    // students (role=student, userType=college). `orgUnit` is the single assigned
    // OrgUnit; `rollNumber` is the student's roll — PER-COLLEGE unique (two
    // colleges may share a roll). Individual users leave both unset and keep
    // their roll number on Profile as before.
    orgUnit: { type: Schema.Types.ObjectId, ref: "OrgUnit", default: null },
    rollNumber: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    forcePasswordChange: { type: Boolean, default: false },
    // Bumped to revoke ALL sessions at once (embedded in every token).
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

// username is unique via its field option. email is PARTIAL-unique: migrated
// legacy accounts may have a blank email (a valid state), so uniqueness is
// enforced only on non-empty values ({ $gt: "" } excludes "" and missing).
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $gt: "" } } },
);
userSchema.index({ role: 1 });
// Tenant membership lookups (e.g. a college's users by role). Individual users
// have college:null and are unaffected.
userSchema.index({ college: 1, role: 1 });
// PER-COLLEGE roll-number uniqueness (Phase 3). PARTIAL so it applies ONLY to
// college students — docs that have BOTH a college (ObjectId) and a non-empty
// rollNumber. Individual users (college:null) and faculty (no User.rollNumber)
// are excluded, so two different colleges may reuse the same roll number and the
// existing global Profile.rollNumber index is untouched.
userSchema.index(
  { college: 1, rollNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      college: { $type: "objectId" },
      rollNumber: { $gt: "" },
    },
  },
);
// College-student listing filtered by org-unit (and the deleteOrgUnit student
// guard's count). Additive; individual users have orgUnit:null.
userSchema.index({ college: 1, orgUnit: 1 });

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model("User", userSchema);

const profileSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    fullName: { type: String, required: true, trim: true },
    collegeName: { type: String, trim: true },
    // roll_number uniqueness was enforced at registration in Django. Partial-
    // unique here: migrated staff/older profiles may have a blank roll number.
    rollNumber: { type: String, required: true, trim: true },
    phoneNumber: { type: String, trim: true },
    state: { type: String, trim: true },
    bio: { type: String, default: "" },
    // Defaulted to a ui-avatars URL by the service layer on creation.
    avatarUrl: { type: String, default: "" },
  },
  { timestamps: true },
);
// PARTIAL-unique roll number: migrated staff/older profiles may legitimately
// have a blank roll number, so uniqueness is enforced only on non-empty values.
profileSchema.index(
  { rollNumber: 1 },
  { unique: true, partialFilterExpression: { rollNumber: { $gt: "" } } },
);

export type Profile = InferSchemaType<typeof profileSchema>;
export const ProfileModel = model("Profile", profileSchema);
