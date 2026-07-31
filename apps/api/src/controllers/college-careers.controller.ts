/**
 * College careers/postings controllers (Phase 5b) — thin: validate with shared
 * zod schemas, delegate to the tenant-scoped college-careers service. The
 * college id comes from the validated `req.tenant`; the ACTOR (for faculty
 * scope) from `req.auth`. Both are guaranteed by the route's requireAuth →
 * resolveTenant stack.
 *
 * Authoring handlers are mounted behind requireFaculty + requireFeature('postings');
 * the student handlers (list/detail/apply) behind tenant membership + the
 * feature. The apply WRITE reuses the shared careers.service apply (open-gate +
 * idempotency), so it is not duplicated here.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  applyRequestSchema,
  createCollegePostingSchema,
  setPostingPublishSchema,
  updateApplicationStatusRequestSchema,
  updateCollegePostingSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as postings from "../services/college-careers.service.js";
import type { PostingActor } from "../services/college-careers.service.js";

function tenantId(req: Request): string {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant.college.id;
}

function actor(req: Request): PostingActor {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

// --- Authoring ---------------------------------------------------------------

export const listCollegePostingsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(await postings.listCollegePostings(tenantId(req), actor(req)));
  },
);

export const createCollegePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createCollegePostingSchema.parse(req.body);
    res
      .status(201)
      .json(
        await postings.createCollegePosting(tenantId(req), actor(req), input),
      );
  },
);

export const getCollegePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await postings.getCollegePosting(
          tenantId(req),
          actor(req),
          req.params.postingId ?? "",
        ),
      );
  },
);

export const updateCollegePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateCollegePostingSchema.parse(req.body);
    res
      .status(200)
      .json(
        await postings.updateCollegePosting(
          tenantId(req),
          actor(req),
          req.params.postingId ?? "",
          input,
        ),
      );
  },
);

export const setCollegePostingPublishController = asyncHandler(
  async (req: Request, res: Response) => {
    const { isPublished } = setPostingPublishSchema.parse(req.body);
    res
      .status(200)
      .json(
        await postings.setCollegePostingPublished(
          tenantId(req),
          actor(req),
          req.params.postingId ?? "",
          isPublished,
        ),
      );
  },
);

export const deleteCollegePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await postings.removeCollegePosting(
          tenantId(req),
          actor(req),
          req.params.postingId ?? "",
        ),
      );
  },
);

export const collegePostingApplicationsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await postings.collegePostingApplications(
          tenantId(req),
          actor(req),
          req.params.postingId ?? "",
        ),
      );
  },
);

export const updateCollegeApplicationStatusController = asyncHandler(
  async (req: Request, res: Response) => {
    const { status } = updateApplicationStatusRequestSchema.parse(req.body);
    res
      .status(200)
      .json(
        await postings.updateCollegeApplicationStatus(
          tenantId(req),
          actor(req),
          req.params.appId ?? "",
          status,
        ),
      );
  },
);

// --- Browsing / applying (college student) -----------------------------------

export const listStudentCollegePostingsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await postings.listStudentCollegePostings(
          tenantId(req),
          actor(req).userId,
        ),
      );
  },
);

export const getStudentCollegePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await postings.getStudentCollegePosting(
          tenantId(req),
          actor(req).userId,
          req.params.postingId ?? "",
        ),
      );
  },
);

export const applyStudentCollegePostingController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = applyRequestSchema.parse(req.body);
    res
      .status(201)
      .json(
        await postings.applyToStudentCollegePosting(
          tenantId(req),
          actor(req).userId,
          req.params.postingId ?? "",
          input,
        ),
      );
  },
);
