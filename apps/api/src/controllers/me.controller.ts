/**
 * "me" controllers — current user + profile read/update.
 */
import {
  AuthErrorCode,
  updateMeSchema,
  type MeResponse,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import { toPublicProfile, toPublicUser } from "../lib/serializers.js";
import { getMe, getMyCollege, updateMe } from "../services/me.service.js";

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

export const getMeController = asyncHandler(
  async (req: Request, res: Response) => {
    const { user, profile } = await getMe(requireUserId(req));
    const body: MeResponse = {
      user: toPublicUser(user),
      profile: toPublicProfile(profile),
    };
    res.status(200).json(body);
  },
);

export const getMyCollegeController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await getMyCollege(requireUserId(req)));
  },
);

export const updateMeController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateMeSchema.parse(req.body);
    const { user, profile } = await updateMe(requireUserId(req), input);
    const body: MeResponse = {
      user: toPublicUser(user),
      profile: toPublicProfile(profile),
    };
    res.status(200).json(body);
  },
);
