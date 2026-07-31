/**
 * Curriculum controllers — thin: validate with shared zod schemas, resolve the
 * caller, delegate to the service, shape the response.
 */
import {
  AuthErrorCode,
  EnrollResult,
  UserType,
  catalogQuerySchema,
  quizSubmitRequestSchema,
  topicCompleteRequestSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as curriculum from "../services/curriculum.service.js";

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

export const getCatalogController = asyncHandler(
  async (req: Request, res: Response) => {
    const query = catalogQuerySchema.parse(req.query);
    const data = await curriculum.getCatalog(query, req.auth?.userId);
    res.status(200).json(data);
  },
);

export const getSubjectDetailController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await curriculum.getSubjectDetail(
      req.params.slug ?? "",
      req.auth?.userId,
    );
    res.status(200).json(data);
  },
);

export const enrollController = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    // College students are enrolled by their college (assignment), never by
    // self-enrolling from the public catalog — so their access stays exactly the
    // set of courses assigned to them. Individual (B2C) self-enroll is unchanged.
    if (req.auth?.userType === UserType.COLLEGE) {
      throw new AppError(
        "College students are enrolled in courses by their college",
        403,
        AuthErrorCode.FORBIDDEN,
      );
    }
    const data = await curriculum.enroll(req.params.slug ?? "", userId);
    res.status(data.result === EnrollResult.ENROLLED ? 201 : 200).json(data);
  },
);

export const getMyEnrollmentsController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await curriculum.getMyEnrollments(requireUserId(req));
    res.status(200).json(data);
  },
);

export const getTopicContentController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await curriculum.getTopicContent(
      req.params.slug ?? "",
      req.params.topicId ?? "",
      requireUserId(req),
    );
    res.status(200).json(data);
  },
);

export const completeTopicController = asyncHandler(
  async (req: Request, res: Response) => {
    const { completed } = topicCompleteRequestSchema.parse(req.body);
    const data = await curriculum.setTopicCompletion(
      req.params.slug ?? "",
      req.params.topicId ?? "",
      requireUserId(req),
      completed,
    );
    res.status(200).json(data);
  },
);

export const getQuizController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await curriculum.getQuiz(
      req.params.slug ?? "",
      req.params.topicId ?? "",
      requireUserId(req),
    );
    res.status(200).json(data);
  },
);

export const submitQuizController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = quizSubmitRequestSchema.parse(req.body);
    const data = await curriculum.submitQuiz(
      req.params.slug ?? "",
      req.params.topicId ?? "",
      requireUserId(req),
      input,
    );
    res.status(200).json(data);
  },
);
