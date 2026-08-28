/**
 * College (tenant) service — provisioning + entitlement control for super_admin,
 * plus the pure helpers the tenancy middleware builds on.
 *
 * Entitlements are stored on the college as Mongoose Maps; every read
 * normalizes them to the framework-free {@link CollegeEntitlements} shape from
 * @codeapt/shared so guards/UI share ONE representation and ONE check
 * (checkEntitlement). No HTTP here — controllers call these.
 *
 * See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
import {
  DEFAULT_AI_CREDIT_TIER,
  FacultyErrorCode,
  isKnownSubCapability,
  Role,
  TenantErrorCode,
  UserType,
  type AiCreditTier,
  type College as CollegeDTO,
  type CollegeAdmin,
  type CollegeBranding,
  type CollegeEntitlements,
  type CreateCollegeAdminInput,
  type CreateCollegeInput,
  type GrantedCoursesResponse,
  type SetEntitlementsInput,
  type UpdateCollegeInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { hashPassword } from "../lib/password.js";
import { CollegeModel, type College } from "../models/college.model.js";
import { SubjectModel } from "../models/curriculum.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

// The hydrated document type Mongoose produces for the model (timestamps + Map
// methods + save/markModified included) — derived from the model itself so it
// never drifts from the schema.
type CollegeDoc = InstanceType<typeof CollegeModel>;

// ---------------------------------------------------------------------------
// Normalization (Map/ObjectId storage → the plain shared shape)
// ---------------------------------------------------------------------------

function mapToRecord(
  m: Map<string, boolean> | Record<string, boolean> | undefined | null,
): Record<string, boolean> {
  if (!m) return {};
  if (m instanceof Map) return Object.fromEntries(m);
  return { ...m };
}

// Sub-capabilities use dotted keys ("exams.public_links") in the API + the
// shared logic, but Mongoose Maps FORBID "." in keys. We translate to a
// Map-safe delimiter ("::") at the storage boundary only — lossless because no
// feature/sub-capability name contains "." or "::".
const STORE_DELIM = "::";
const toStoreKey = (dotted: string): string =>
  dotted.split(".").join(STORE_DELIM);
const fromStoreKey = (stored: string): string =>
  stored.split(STORE_DELIM).join(".");

/** Normalize a college's stored entitlements to the shared plain shape. */
export function normalizeEntitlements(college: CollegeDoc): CollegeEntitlements {
  const e = college.entitlements;
  const subCapabilities: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(mapToRecord(e?.subCapabilities))) {
    subCapabilities[fromStoreKey(k)] = v;
  }
  return {
    features: mapToRecord(e?.features) as CollegeEntitlements["features"],
    subCapabilities,
    grantedCourses: (e?.grantedCourses ?? []).map((id) => id.toString()),
  };
}

function toDTO(college: CollegeDoc): CollegeDTO {
  return {
    id: college._id.toString(),
    name: college.name,
    slug: college.slug,
    status: college.status,
    contactEmail: college.contactEmail ?? "",
    contactPhone: college.contactPhone ?? "",
    createdBy: college.createdBy ? college.createdBy.toString() : null,
    entitlements: normalizeEntitlements(college),
    branding: {
      logoUrl: college.branding?.logoUrl ?? "",
      displayName: college.branding?.displayName ?? "",
      welcomeText: college.branding?.welcomeText ?? "",
      brandColor: college.branding?.brandColor ?? "",
    },
    credits: {
      tier: (college.credits?.tier ?? DEFAULT_AI_CREDIT_TIER) as AiCreditTier,
      monthlyOverride: college.credits?.monthlyOverride ?? null,
      perStudentDistribution: college.credits?.perStudentDistribution ?? false,
      interviewCredits: college.credits?.interviewCredits ?? 0,
    },
    createdAt: college.createdAt.toISOString(),
    updatedAt: college.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Fetch a college document by slug (the /c/:slug tenant key), or null. */
export async function findCollegeBySlug(
  slug: string,
): Promise<CollegeDoc | null> {
  return CollegeModel.findOne({ slug: slug.toLowerCase() });
}

async function getDocOrThrow(id: string): Promise<CollegeDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "College not found",
      404,
      TenantErrorCode.COLLEGE_NOT_FOUND,
    );
  }
  const college = await CollegeModel.findById(id);
  if (!college) {
    throw new AppError(
      "College not found",
      404,
      TenantErrorCode.COLLEGE_NOT_FOUND,
    );
  }
  return college;
}

// ---------------------------------------------------------------------------
// Provisioning (super_admin)
// ---------------------------------------------------------------------------

export async function createCollege(
  input: CreateCollegeInput,
  createdByUserId: string,
): Promise<CollegeDTO> {
  const slug = input.slug.toLowerCase();
  const exists = await CollegeModel.exists({ slug });
  if (exists) {
    throw new AppError(
      `A college with slug "${slug}" already exists`,
      409,
      TenantErrorCode.COLLEGE_SLUG_TAKEN,
    );
  }
  const college = await CollegeModel.create({
    name: input.name,
    slug,
    status: input.status ?? undefined,
    contactEmail: input.contactEmail ?? "",
    contactPhone: input.contactPhone ?? "",
    createdBy: new Types.ObjectId(createdByUserId),
    // entitlements default to empty (nothing granted) via the schema.
  });
  return toDTO(college);
}

export async function listColleges(): Promise<CollegeDTO[]> {
  const colleges = await CollegeModel.find().sort({ createdAt: -1 });
  return colleges.map(toDTO);
}

export async function getCollege(id: string): Promise<CollegeDTO> {
  return toDTO(await getDocOrThrow(id));
}

export async function updateCollege(
  id: string,
  input: UpdateCollegeInput,
): Promise<CollegeDTO> {
  const college = await getDocOrThrow(id);
  if (input.name !== undefined) college.name = input.name;
  if (input.contactEmail !== undefined) college.contactEmail = input.contactEmail;
  if (input.contactPhone !== undefined) college.contactPhone = input.contactPhone;
  if (input.status !== undefined) college.status = input.status;
  if (input.branding) {
    college.branding ??= {
      logoUrl: "",
      displayName: "",
      welcomeText: "",
      brandColor: "",
    };
    const b = input.branding;
    if (b.logoUrl !== undefined) college.branding.logoUrl = b.logoUrl;
    if (b.displayName !== undefined) college.branding.displayName = b.displayName;
    if (b.welcomeText !== undefined) college.branding.welcomeText = b.welcomeText;
    if (b.brandColor !== undefined) college.branding.brandColor = b.brandColor;
    college.markModified("branding");
  }
  await college.save();
  return toDTO(college);
}

/**
 * PUBLIC branding for a college's login page (pre-auth). Returns ONLY brand
 * fields — never entitlements, contacts, or member data — with `displayName`
 * resolved to the college name when no custom name is set. 404 if no such slug.
 */
export async function getPublicBranding(slug: string): Promise<CollegeBranding> {
  const college = await CollegeModel.findOne({
    slug: slug.trim().toLowerCase(),
  });
  if (!college) {
    throw new AppError("College not found", 404, "COLLEGE_NOT_FOUND");
  }
  return {
    slug: college.slug,
    displayName: college.branding?.displayName?.trim() || college.name,
    logoUrl: college.branding?.logoUrl ?? "",
    welcomeText: college.branding?.welcomeText ?? "",
    brandColor: college.branding?.brandColor ?? "",
  };
}

// ---------------------------------------------------------------------------
// Entitlements (add/remove anytime; super_admin only)
// ---------------------------------------------------------------------------

export async function setEntitlements(
  id: string,
  input: SetEntitlementsInput,
): Promise<CollegeDTO> {
  const college = await getDocOrThrow(id);

  if (input.features) {
    for (const [feature, enabled] of Object.entries(input.features)) {
      college.entitlements.features.set(feature, enabled);
    }
    college.markModified("entitlements.features");
  }

  if (input.subCapabilities) {
    for (const [key, enabled] of Object.entries(input.subCapabilities)) {
      if (!isKnownSubCapability(key)) {
        throw new AppError(
          `Unknown sub-capability "${key}"`,
          400,
          "BAD_REQUEST",
          { key },
        );
      }
      college.entitlements.subCapabilities.set(toStoreKey(key), enabled);
    }
    college.markModified("entitlements.subCapabilities");
  }

  await college.save();
  return toDTO(college);
}

/** Validate that every id is a real, existing master-catalog course (Subject). */
async function assertCoursesExist(courseIds: string[]): Promise<void> {
  const invalid = courseIds.filter((id) => !Types.ObjectId.isValid(id));
  if (invalid.length > 0) {
    throw new AppError("Invalid course id(s)", 400, "BAD_REQUEST", { invalid });
  }
  const unique = [...new Set(courseIds)];
  const found = await SubjectModel.find({ _id: { $in: unique } }).select("_id");
  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((s) => s._id.toString()));
    throw new AppError("Unknown course id(s)", 400, "BAD_REQUEST", {
      unknown: unique.filter((id) => !foundIds.has(id)),
    });
  }
}

export async function grantCourses(
  id: string,
  courseIds: string[],
): Promise<CollegeDTO> {
  const college = await getDocOrThrow(id);
  await assertCoursesExist(courseIds);

  const merged = new Set(
    college.entitlements.grantedCourses.map((c) => c.toString()),
  );
  for (const cid of courseIds) merged.add(cid);
  college.entitlements.grantedCourses = [...merged].map(
    (cid) => new Types.ObjectId(cid),
  );
  college.markModified("entitlements.grantedCourses");
  await college.save();
  return toDTO(college);
}

export async function revokeCourses(
  id: string,
  courseIds: string[],
): Promise<CollegeDTO> {
  const college = await getDocOrThrow(id);
  const remove = new Set(courseIds);
  college.entitlements.grantedCourses = college.entitlements.grantedCourses.filter(
    (c) => !remove.has(c.toString()),
  );
  college.markModified("entitlements.grantedCourses");
  await college.save();
  return toDTO(college);
}

// ---------------------------------------------------------------------------
// College admins — super_admin provisions who runs a college's workspace.
// A college_admin is a User (role=college_admin, userType=college, college=this,
// forcePasswordChange). Reuses the existing secure user-creation conventions
// (argon2 hashPassword, uniqueness checks, User+Profile with rollback) — mirrors
// faculty.service. This is the platform console, not a /c/:slug tenant route, so
// it is super-admin-guarded rather than resolveTenant-scoped.
// ---------------------------------------------------------------------------

function buildAvatarUrl(username: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    username,
  )}&background=random`;
}

type UserDoc = InstanceType<typeof UserModel>;

function toCollegeAdminDTO(user: UserDoc, fullName: string): CollegeAdmin {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    fullName,
    role: user.role as Role,
    isActive: user.isActive,
    forcePasswordChange: user.forcePasswordChange,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function createCollegeAdmin(
  collegeId: string,
  input: CreateCollegeAdminInput,
): Promise<CollegeAdmin> {
  const college = await getDocOrThrow(collegeId);

  if (await UserModel.exists({ email: input.email })) {
    throw new AppError(
      "Email is already registered",
      409,
      FacultyErrorCode.EMAIL_TAKEN,
    );
  }
  if (await UserModel.exists({ username: input.username })) {
    throw new AppError(
      "Username is already taken",
      409,
      FacultyErrorCode.USERNAME_TAKEN,
    );
  }

  const passwordHash = await hashPassword(input.password);
  const user = await UserModel.create({
    username: input.username,
    email: input.email,
    passwordHash,
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: college._id,
    forcePasswordChange: true,
  });

  try {
    await ProfileModel.create({
      user: user._id,
      fullName: input.fullName,
      // College admins have no roll number; a per-user placeholder keeps the
      // required + partial-unique Profile.rollNumber index satisfied.
      rollNumber: `ADMIN-${user._id.toString()}`,
      avatarUrl: buildAvatarUrl(input.username),
    });
  } catch (err) {
    // No standalone-Mongo transactions — roll back the user to avoid an orphan.
    await UserModel.deleteOne({ _id: user._id });
    throw err;
  }
  return toCollegeAdminDTO(user, input.fullName);
}

export async function listCollegeAdmins(
  collegeId: string,
): Promise<CollegeAdmin[]> {
  await getDocOrThrow(collegeId);
  const users = await UserModel.find({
    college: new Types.ObjectId(collegeId),
    role: Role.COLLEGE_ADMIN,
  }).sort({ createdAt: -1 });

  const names = await ProfileModel.find({
    user: { $in: users.map((u) => u._id) },
  }).select("user fullName");
  const nameByUser = new Map(names.map((p) => [p.user.toString(), p.fullName]));

  return users.map((u) =>
    toCollegeAdminDTO(u, nameByUser.get(u._id.toString()) ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Tenant context (used by resolveTenant) + granted-course listing
// ---------------------------------------------------------------------------

export interface TenantContext {
  college: { id: string; slug: string; name: string; status: College["status"] };
  entitlements: CollegeEntitlements;
  role: Role;
}

/** Build the request tenant context from a resolved college + caller role. */
export function buildTenantContext(
  college: CollegeDoc,
  role: Role,
): TenantContext {
  return {
    college: {
      id: college._id.toString(),
      slug: college.slug,
      name: college.name,
      status: college.status,
    },
    entitlements: normalizeEntitlements(college),
    role,
  };
}

/**
 * The master-catalog courses granted to a college (for /c/:slug/courses).
 * Takes the granted ids straight from the resolved tenant context.
 */
export async function listGrantedCourses(
  grantedCourseIds: string[],
): Promise<GrantedCoursesResponse> {
  const ids = grantedCourseIds.filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return { items: [] };
  const subjects = await SubjectModel.find({ _id: { $in: ids } }).select(
    "slug name",
  );
  return {
    items: subjects.map((s) => ({
      id: s._id.toString(),
      slug: s.slug,
      name: s.name,
    })),
  };
}
