/**
 * Order ADMIN service (ledger read — CRUD batch 3a). READ/reporting over the
 * Order ledger. Mirrors the other admin read services (thin, admin-guarded at
 * the route; AppError envelope) and performs NO writes.
 *
 * Money is stored as INTEGER PAISE and passed through unchanged (the web layer
 * formats with formatINR). Gateway-owned fields (`transactionId` + the
 * gateway-driven `status`) are surfaced in a dedicated `gateway` block and are
 * never editable here — they are set only by the verified payment callback /
 * webhook in payment.service.
 */
import {
  OrderErrorCode,
  type AdminOrderDetail,
  type AdminOrderListQuery,
  type AdminOrderListResponse,
  type PaymentStatus,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { OrderModel } from "../models/commerce.model.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

// Escape user input before it becomes a case-insensitive regex.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Null-safe ISO. Migrated/imported orders can lack Mongoose's timestamp fields;
// `new Date(undefined).toISOString()` throws "Invalid time value" (a 500), so a
// missing/invalid date serializes to null (the web layer renders it as "—").
function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// List / search
// ---------------------------------------------------------------------------

export async function listOrdersAdmin(
  query: AdminOrderListQuery,
): Promise<AdminOrderListResponse> {
  const { status, q, page, pageSize } = query;

  const match: Record<string, unknown> = {};
  if (status) match.status = status;
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    match.$or = [{ orderId: rx }, { transactionId: rx }, { couponCode: rx }];
  }

  const rows = await OrderModel.aggregate<{
    items: {
      _id: Types.ObjectId;
      orderId: string;
      status: string;
      amount: number;
      couponCode?: string | null;
      createdAt: Date;
      student?: string;
      subject?: string;
    }[];
    total: { n: number }[];
  }>([
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: "profiles",
              localField: "user",
              foreignField: "user",
              as: "profile",
            },
          },
          { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "subjects",
              localField: "subject",
              foreignField: "_id",
              as: "subjectDoc",
            },
          },
          { $unwind: { path: "$subjectDoc", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              orderId: 1,
              status: 1,
              amount: 1,
              couponCode: 1,
              createdAt: 1,
              student: "$profile.fullName",
              subject: "$subjectDoc.name",
            },
          },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const facet = rows[0] ?? { items: [], total: [] };
  return {
    items: facet.items.map((o) => ({
      id: o._id.toString(),
      orderId: o.orderId,
      status: o.status as PaymentStatus,
      amount: o.amount,
      student: o.student ?? "(unknown)",
      subject: o.subject ?? "(removed subject)",
      couponCode: o.couponCode ?? null,
      createdAt: iso(o.createdAt),
    })),
    total: facet.total[0]?.n ?? 0,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Per-order detail
// ---------------------------------------------------------------------------

export async function getOrderDetailAdmin(
  id: string,
): Promise<AdminOrderDetail> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Order not found", 404, OrderErrorCode.ORDER_NOT_FOUND);
  }
  const order = await OrderModel.findById(id).populate<{
    subject: { name: string } | null;
  }>("subject", "name");
  if (!order) {
    throw new AppError("Order not found", 404, OrderErrorCode.ORDER_NOT_FOUND);
  }

  const [profile, user] = await Promise.all([
    ProfileModel.findOne({ user: order.user }).lean<{ fullName: string } | null>(),
    UserModel.findById(order.user).lean<{ email: string } | null>(),
  ]);

  const status = order.status as PaymentStatus;
  return {
    id: order._id.toString(),
    orderId: order.orderId,
    status,
    amount: order.amount,
    discountAmount: order.discountAmount ?? 0,
    couponCode: order.couponCode ?? null,
    student: profile?.fullName ?? "(unknown)",
    studentEmail: user?.email ?? "",
    subject: order.subject?.name ?? "(removed subject)",
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    // Gateway-owned — read-only, set by the verified callback/webhook only.
    gateway: {
      transactionId: order.transactionId ?? null,
      status,
    },
  };
}
