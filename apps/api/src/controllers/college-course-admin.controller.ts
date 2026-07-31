/**
 * College course-assignment controllers (college_admin + scoped faculty). Thin:
 * validate with shared zod schemas, delegate to the tenant-scoped service. The
 * college id + granted-course list come from the validated `req.tenant`; the
 * actor (for faculty scope) from `req.auth`.
 */
import {
  AuthErrorCode,
  courseAssignmentRequestSchema,
  TenantErrorCode,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as courses from "../services/college-course.service.js";
import type { StudentActor } from "../services/student.service.js";

function tenant(req: Request): { collegeId: string; grantedCourseIds: string[] } {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return {
    collegeId: req.tenant.college.id,
    grantedCourseIds: req.tenant.entitlements.grantedCourses,
  };
}

function actor(req: Request): StudentActor {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

export const listCollegeCoursesController = asyncHandler(
  async (req: Request, res: Response) => {
    const { collegeId, grantedCourseIds } = tenant(req);
    res
      .status(200)
      .json(await courses.listCollegeCourses(collegeId, grantedCourseIds));
  },
);

export const assignCourseController = asyncHandler(
  async (req: Request, res: Response) => {
    const { collegeId, grantedCourseIds } = tenant(req);
    const { studentIds } = courseAssignmentRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await courses.assignCourse(
          collegeId,
          actor(req),
          grantedCourseIds,
          req.params.courseId ?? "",
          studentIds,
        ),
      );
  },
);

export const revokeCourseController = asyncHandler(
  async (req: Request, res: Response) => {
    const { collegeId, grantedCourseIds } = tenant(req);
    const { studentIds } = courseAssignmentRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await courses.revokeCourse(
          collegeId,
          actor(req),
          grantedCourseIds,
          req.params.courseId ?? "",
          studentIds,
        ),
      );
  },
);

export const listCourseAssignmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const { collegeId } = tenant(req);
    res
      .status(200)
      .json(
        await courses.listCourseAssignments(
          collegeId,
          actor(req),
          req.params.courseId ?? "",
        ),
      );
  },
);
