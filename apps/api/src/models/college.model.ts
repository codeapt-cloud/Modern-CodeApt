/**
 * College (tenant) model — the spine of the multi-tenant upgrade.
 *
 * A College is a tenant that CodeApt's super_admin provisions. It carries the
 * ENTITLEMENTS structure that gates everything the college may use:
 *  - features:        Map<feature, boolean>   (on/off per FEATURE)
 *  - subCapabilities: Map<"feature.subcap", boolean>  (finer, extensible)
 *  - grantedCourses:  [Subject]               (master-catalog resource grants)
 *
 * Maps (not scattered booleans) keep the structure forward-compatible: new
 * features / sub-capabilities need no schema migration. The pure entitlement
 * logic lives in @codeapt/shared (checkEntitlement); this model just stores it.
 *
 * Tenancy rule: college-scoped documents in LATER phases carry a `college` ref
 * and are ALWAYS queried through the tenant-scope helper. Individual (B2C) data
 * is never tenant-scoped and never references a college.
 *
 * See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import {
  AI_CREDIT_TIER_VALUES,
  COLLEGE_STATUS_VALUES,
  CollegeStatus,
  DEFAULT_AI_CREDIT_TIER,
} from "@codeapt/shared";

// Entitlements sub-document (no own _id — it is owned 1:1 by the college).
const entitlementsSchema = new Schema(
  {
    /** feature key → enabled. Absent/false = OFF. */
    features: { type: Map, of: Boolean, default: () => ({}) },
    /** "feature.subCapability" → enabled. */
    subCapabilities: { type: Map, of: Boolean, default: () => ({}) },
    /** Granted master-catalog courses (Subject ids). */
    grantedCourses: [{ type: Schema.Types.ObjectId, ref: "Subject" }],
  },
  { _id: false },
);

// Login-page branding sub-document (public skin of /c/:slug/login). All optional
// — empty falls back cleanly. No secrets: every field here is publicly served.
const brandingSchema = new Schema(
  {
    logoUrl: { type: String, default: "", trim: true },
    displayName: { type: String, default: "", trim: true },
    welcomeText: { type: String, default: "", trim: true },
    brandColor: { type: String, default: "", trim: true },
  },
  { _id: false },
);

// AI credit CONFIG sub-document (Stage 1) — the tier + optional explicit monthly
// override that drive the per-college allocation. The live balance (allocated/
// consumed per period) is a separate ledger collection, not stored here.
const creditsSchema = new Schema(
  {
    tier: {
      type: String,
      enum: AI_CREDIT_TIER_VALUES,
      default: DEFAULT_AI_CREDIT_TIER,
    },
    // Explicit monthly credits; null = use the tier formula.
    monthlyOverride: { type: Number, default: null },
  },
  { _id: false },
);

// Attendance operational settings (Prompt 1) — a college-level permission that
// lets scoped FACULTY form CROSS-CUTTING / Excel groups (students outside their
// org-unit scope). Off by default: faculty are confined to their scope until an
// admin turns this on. college_admins/platform admins are unrestricted anyway.
const attendanceSettingsSchema = new Schema(
  {
    facultyCanFormCrossCuttingGroups: { type: Boolean, default: false },
  },
  { _id: false },
);

const collegeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // The stable URL key for /c/:slug. Globally unique (tenants share one URL
    // namespace); always non-empty so a plain unique index is correct.
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: COLLEGE_STATUS_VALUES,
      default: CollegeStatus.ACTIVE,
    },
    contactEmail: { type: String, trim: true, lowercase: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },
    // The super_admin who provisioned the college.
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    entitlements: { type: entitlementsSchema, default: () => ({}) },
    branding: { type: brandingSchema, default: () => ({}) },
    credits: { type: creditsSchema, default: () => ({}) },
    attendanceSettings: {
      type: attendanceSettingsSchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);
collegeSchema.index({ status: 1 });

export type College = InferSchemaType<typeof collegeSchema>;
export const CollegeModel = model("College", collegeSchema);
