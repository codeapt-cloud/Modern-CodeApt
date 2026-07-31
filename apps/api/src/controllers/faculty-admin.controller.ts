/**
 * Faculty controllers (college_admin + faculty_management feature). Thin:
 * validate with shared zod schemas, delegate to the tenant-scoped faculty
 * service. College id comes from the validated `req.tenant`.
 */
import {
  createFacultySchema,
  TenantErrorCode,
  updateFacultySchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as faculty from "../services/faculty.service.js";

function tenantCollegeId(req: Request): string {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant.college.id;
}

export const listFacultyController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await faculty.listFaculty(tenantCollegeId(req));
    res.status(200).json({ items });
  },
);

export const createFacultyController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createFacultySchema.parse(req.body);
    res.status(201).json(await faculty.createFaculty(tenantCollegeId(req), input));
  },
);

export const updateFacultyController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateFacultySchema.parse(req.body);
    res
      .status(200)
      .json(
        await faculty.updateFaculty(
          tenantCollegeId(req),
          req.params.facultyId ?? "",
          input,
        ),
      );
  },
);

export const deactivateFacultyController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await faculty.deactivateFaculty(
          tenantCollegeId(req),
          req.params.facultyId ?? "",
        ),
      );
  },
);
