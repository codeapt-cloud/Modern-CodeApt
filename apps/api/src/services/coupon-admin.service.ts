/**
 * Coupon ADMIN service — CRUD over the Coupon model that checkout redeems.
 * Mirrors the curriculum/careers admin pattern (thin, zod-validated writes
 * behind requireAdmin; AppError envelope). Money stays integer paise; the
 * percent/fixed split is validated at the shared schema and persisted to the
 * single `discountValue` field the redemption path already reads.
 *
 * Delete semantics: a coupon referenced by ANY order is BLOCKED from hard
 * delete (409 DELETE_BLOCKED, details.blockers = { orders }) — destroying it
 * would orphan redemption history. The honest "retire" action is deactivation
 * (active=false), offered both in the editor and as a one-click list toggle.
 * An unreferenced coupon deletes cleanly.
 */
import {
  CouponErrorCode,
  type AdminCoupon,
  type AdminCouponListResponse,
  type AdminCouponUpsert,
} from "@codeapt/shared";
import { Types, type HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import {
  CouponModel,
  OrderModel,
  type Coupon,
} from "../models/commerce.model.js";
import { SubjectModel } from "../models/curriculum.model.js";

type CouponDoc = HydratedDocument<Coupon>;

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Coupon not found", 404, CouponErrorCode.COUPON_NOT_FOUND);
  }
  return new Types.ObjectId(id);
}

async function loadCoupon(id: string): Promise<CouponDoc> {
  const coupon = await CouponModel.findById(objectId(id));
  if (!coupon) {
    throw new AppError("Coupon not found", 404, CouponErrorCode.COUPON_NOT_FOUND);
  }
  return coupon;
}

/** Count orders referencing each coupon → Map<couponId, count>. */
async function orderCountsByCoupon(): Promise<Map<string, number>> {
  const rows = await OrderModel.aggregate<{ _id: Types.ObjectId | null; c: number }>(
    [
      { $match: { coupon: { $ne: null } } },
      { $group: { _id: "$coupon", c: { $sum: 1 } } },
    ],
  );
  return new Map(rows.filter((r) => r._id).map((r) => [r._id!.toString(), r.c]));
}

function toAdminCoupon(
  c: CouponDoc,
  orderCount: number,
  subjectName: string | null,
): AdminCoupon {
  return {
    id: c._id.toString(),
    code: c.code,
    discountType: c.discountType,
    discountValue: c.discountValue,
    active: c.active,
    validFrom: c.validFrom ? c.validFrom.toISOString() : null,
    validTo: c.validTo ? c.validTo.toISOString() : null,
    usageLimit: c.usageLimit ?? null,
    perUserLimit: c.perUserLimit,
    minOrderPaise: c.minOrderPaise,
    usedCount: c.usedCount,
    orderCount,
    subjectId: c.subject ? c.subject.toString() : null,
    subjectName,
  };
}

/** Normalise + uniqueness-check the code (stored uppercase); excludes self. */
async function ensureCodeFree(code: string, selfId?: Types.ObjectId): Promise<string> {
  const normalized = code.trim().toUpperCase();
  const clash = await CouponModel.findOne({ code: normalized }).select("_id");
  if (clash && (!selfId || clash._id.toString() !== selfId.toString())) {
    throw new AppError(
      `The code "${normalized}" is already in use`,
      409,
      CouponErrorCode.CODE_TAKEN,
      { code: normalized },
    );
  }
  return normalized;
}

/** Validate the optional scope subject (must exist when provided). */
async function resolveSubjectRef(
  subjectId: string | null | undefined,
): Promise<Types.ObjectId | null> {
  if (subjectId == null || subjectId === "") return null;
  if (!Types.ObjectId.isValid(subjectId)) {
    throw new AppError("Course not found", 404, CouponErrorCode.SUBJECT_NOT_FOUND);
  }
  const _id = new Types.ObjectId(subjectId);
  if (!(await SubjectModel.exists({ _id }))) {
    throw new AppError("Course not found", 404, CouponErrorCode.SUBJECT_NOT_FOUND);
  }
  return _id;
}

async function subjectNameFor(
  subject: Types.ObjectId | null | undefined,
): Promise<string | null> {
  if (!subject) return null;
  const doc = await SubjectModel.findById(subject).select("name");
  return doc?.name ?? null;
}

/** Fields the write path sets from the (already type-validated) upsert. */
function assignableFields(input: AdminCouponUpsert): {
  discountType: AdminCouponUpsert["discountType"];
  discountValue: number;
  active: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  usageLimit: number | null;
  perUserLimit: number;
  minOrderPaise: number;
} {
  return {
    discountType: input.discountType,
    discountValue: input.discountValue,
    active: input.active,
    validFrom: input.validFrom ? new Date(input.validFrom) : null,
    validTo: input.validTo ? new Date(input.validTo) : null,
    usageLimit: input.usageLimit ?? null,
    perUserLimit: input.perUserLimit,
    minOrderPaise: input.minOrderPaise,
  };
}

// ---------------------------------------------------------------------------

export async function listCouponsAdmin(): Promise<AdminCouponListResponse> {
  const coupons = await CouponModel.find().sort({ createdAt: -1, _id: -1 });
  const [orderCounts, subjects] = await Promise.all([
    orderCountsByCoupon(),
    SubjectModel.find()
      .select("name")
      .lean<{ _id: Types.ObjectId; name: string }[]>(),
  ]);
  const subjectNames = new Map(subjects.map((s) => [s._id.toString(), s.name]));
  return {
    items: coupons.map((c) =>
      toAdminCoupon(
        c,
        orderCounts.get(c._id.toString()) ?? 0,
        c.subject ? (subjectNames.get(c.subject.toString()) ?? null) : null,
      ),
    ),
  };
}

export async function getCouponAdmin(id: string): Promise<AdminCoupon> {
  const coupon = await loadCoupon(id);
  const orderCount = await OrderModel.countDocuments({ coupon: coupon._id });
  return toAdminCoupon(coupon, orderCount, await subjectNameFor(coupon.subject));
}

export async function createCoupon(input: AdminCouponUpsert): Promise<AdminCoupon> {
  const code = await ensureCodeFree(input.code);
  const subject = await resolveSubjectRef(input.subjectId);
  const coupon = await CouponModel.create({
    code,
    ...assignableFields(input),
    subject: subject ?? undefined,
  });
  return toAdminCoupon(coupon, 0, await subjectNameFor(subject));
}

export async function updateCoupon(
  id: string,
  input: AdminCouponUpsert,
): Promise<AdminCoupon> {
  const coupon = await loadCoupon(id);
  const code = await ensureCodeFree(input.code, coupon._id);
  const subject = await resolveSubjectRef(input.subjectId);
  // usedCount is never edited here — it is owned by the redemption path.
  coupon.set({ code, ...assignableFields(input), subject: subject ?? null });
  await coupon.save();
  const orderCount = await OrderModel.countDocuments({ coupon: coupon._id });
  return toAdminCoupon(coupon, orderCount, await subjectNameFor(subject));
}

export async function setCouponActive(
  id: string,
  active: boolean,
): Promise<AdminCoupon> {
  const coupon = await loadCoupon(id);
  coupon.active = active;
  await coupon.save();
  const orderCount = await OrderModel.countDocuments({ coupon: coupon._id });
  return toAdminCoupon(coupon, orderCount, await subjectNameFor(coupon.subject));
}

export async function deleteCoupon(id: string): Promise<{ deleted: true }> {
  const coupon = await loadCoupon(id);
  const orders = await OrderModel.countDocuments({ coupon: coupon._id });
  if (orders > 0) {
    throw new AppError(
      `Cannot delete "${coupon.code}" — it has redemption history. Deactivate it instead to retire it.`,
      409,
      CouponErrorCode.DELETE_BLOCKED,
      { blockers: { orders } },
    );
  }
  await CouponModel.deleteOne({ _id: coupon._id });
  return { deleted: true };
}
