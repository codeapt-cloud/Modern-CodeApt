/**
 * User ADMIN controllers (requireAdmin at the route). Read/reporting only:
 * validate query with the shared zod schema, delegate to the user-admin
 * service, and stream the per-college performance workbook as an attachment
 * (mirrors the exam results export).
 */
import {
  adminSetUserActiveSchema,
  adminSetUserRoleSchema,
  adminUpdateProfileSchema,
  adminUserListQuerySchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { asyncHandler } from "../lib/async-handler.js";
import * as admin from "../services/user-admin.service.js";

/** The acting admin's id (routes are admin-guarded, so req.auth is set). */
function actorId(req: Request): string {
  return req.auth?.userId ?? "";
}

export const adminListUsersController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = adminUserListQuerySchema.parse(req.query);
    res.status(200).json(await admin.listUsersAdmin(query));
  },
);

export const adminGetUserDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await admin.getUserDetailAdmin(req.params.userId ?? ""));
  },
);

export const adminSetUserActiveController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isActive } = adminSetUserActiveSchema.parse(req.body);
    res
      .status(200)
      .json(
        await admin.setUserActive(
          actorId(req),
          req.params.userId ?? "",
          isActive,
        ),
      );
  },
);

export const adminSetUserRoleController = asyncHandler(
  async (req: Request, res: Response) => {
    const { role } = adminSetUserRoleSchema.parse(req.body);
    res
      .status(200)
      .json(
        await admin.setUserRole(actorId(req), req.params.userId ?? "", role),
      );
  },
);

export const adminUpdateUserProfileController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = adminUpdateProfileSchema.parse(req.body);
    res
      .status(200)
      .json(await admin.updateUserProfile(req.params.userId ?? "", input));
  },
);

export const adminUnenrollUserController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await admin.unenrollUser(
          req.params.userId ?? "",
          req.params.enrollmentId ?? "",
        ),
      );
  },
);

export const adminExportCollegePerformanceController = asyncHandler(
  async (_req: Request, res: Response) => {
    const { buffer, filename } = await admin.exportCollegePerformance();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  },
);

export const adminResetUserPasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await admin.resetUserPasswordAdmin(req.params.userId ?? ""),
      );
  },
);
