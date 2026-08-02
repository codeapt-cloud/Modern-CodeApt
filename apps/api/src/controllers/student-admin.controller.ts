/**
 * College-student controllers (college_admin + scoped faculty). Thin: validate
 * with shared zod schemas, delegate to the tenant-scoped student service. The
 * college id comes from the validated `req.tenant`; the ACTOR (for faculty-scope
 * resolution) comes from `req.auth`. Both are guaranteed present by the route's
 * requireAuth → resolveTenant stack.
 */
import {
  AuthErrorCode,
  collegeStudentListQuerySchema,
  createCollegeStudentSchema,
  studentImportRequestSchema,
  TenantErrorCode,
  updateCollegeStudentSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as students from "../services/student.service.js";
import type { StudentActor } from "../services/student.service.js";

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

export const listStudentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = collegeStudentListQuerySchema.parse(req.query);
    res
      .status(200)
      .json(
        await students.listCollegeStudents(
          tenantCollegeId(req),
          actor(req),
          query,
        ),
      );
  },
);

export const createStudentController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createCollegeStudentSchema.parse(req.body);
    res
      .status(201)
      .json(
        await students.createCollegeStudent(
          tenantCollegeId(req),
          actor(req),
          input,
        ),
      );
  },
);

export const updateStudentController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateCollegeStudentSchema.parse(req.body);
    res
      .status(200)
      .json(
        await students.updateCollegeStudent(
          tenantCollegeId(req),
          actor(req),
          req.params.studentId ?? "",
          input,
        ),
      );
  },
);

export const deactivateStudentController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await students.deactivateCollegeStudent(
          tenantCollegeId(req),
          actor(req),
          req.params.studentId ?? "",
        ),
      );
  },
);

export const previewStudentImportController = asyncHandler(
  async (req: Request, res: Response) => {
    const { rows } = studentImportRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await students.previewStudentImport(
          tenantCollegeId(req),
          actor(req),
          rows,
        ),
      );
  },
);

export const commitStudentImportController = asyncHandler(
  async (req: Request, res: Response) => {
    const { rows } = studentImportRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await students.commitStudentImport(
          tenantCollegeId(req),
          actor(req),
          rows,
        ),
      );
  },
);

export const studentImportTemplateController = asyncHandler(
  async (_req: Request, res: Response) => {
    const csv = students.studentImportTemplateCsv();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="student-import-template.csv"',
    );
    res.status(200).send(csv);
  },
);

export const resetStudentPasswordController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await students.resetStudentPassword(
          tenantCollegeId(req),
          actor(req),
          req.params.studentId ?? "",
        ),
      );
  },
);
