/**
 * College-admin controllers (super_admin only — guarded at the route). Thin:
 * validate with shared zod schemas, delegate to the college service, shape the
 * response. This is the provisioning + entitlement-control surface CodeApt uses
 * to onboard and configure college tenants.
 */
import {
  AuthErrorCode,
  createCollegeAdminSchema,
  createCollegeSchema,
  grantCoursesSchema,
  setCollegeCreditsSchema,
  setEntitlementsSchema,
  updateCollegeSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  getCreditBalance,
  setCredits,
} from "../services/ai-credit.service.js";
import * as colleges from "../services/college.service.js";

function requireUserId(req: Request): string {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return req.auth.userId;
}

export const createCollegeController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createCollegeSchema.parse(req.body);
    const college = await colleges.createCollege(input, requireUserId(req));
    res.status(201).json(college);
  },
);

export const listCollegesController = asyncHandler(
  async (_req: Request, res: Response) => {
    res.status(200).json({ items: await colleges.listColleges() });
  },
);

export const listCollegeAdminsController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await colleges.listCollegeAdmins(req.params.collegeId ?? "");
    res.status(200).json({ items });
  },
);

export const createCollegeAdminController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createCollegeAdminSchema.parse(req.body);
    res
      .status(201)
      .json(
        await colleges.createCollegeAdmin(req.params.collegeId ?? "", input),
      );
  },
);

export const getCollegeController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await colleges.getCollege(req.params.collegeId ?? ""));
  },
);

export const updateCollegeController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateCollegeSchema.parse(req.body);
    res
      .status(200)
      .json(await colleges.updateCollege(req.params.collegeId ?? "", input));
  },
);

export const setEntitlementsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = setEntitlementsSchema.parse(req.body);
    res
      .status(200)
      .json(await colleges.setEntitlements(req.params.collegeId ?? "", input));
  },
);

/** Super-admin: the live AI-credit balance for a college (current period). */
export const getCollegeCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await getCreditBalance(req.params.collegeId ?? "", new Date()));
  },
);

/** Super-admin: set a college's AI-credit tier / explicit override / reset. */
export const setCollegeCreditsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = setCollegeCreditsSchema.parse(req.body);
    res
      .status(200)
      .json(await setCredits(req.params.collegeId ?? "", input, new Date()));
  },
);

export const grantCoursesController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = grantCoursesSchema.parse(req.body);
    res
      .status(200)
      .json(
        await colleges.grantCourses(req.params.collegeId ?? "", input.courseIds),
      );
  },
);

export const revokeCoursesController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = grantCoursesSchema.parse(req.body);
    res
      .status(200)
      .json(
        await colleges.revokeCourses(
          req.params.collegeId ?? "",
          input.courseIds,
        ),
      );
  },
);
