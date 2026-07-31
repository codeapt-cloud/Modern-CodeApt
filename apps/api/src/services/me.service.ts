/**
 * Profile ("me") service — read + update the current user's account.
 * Mirrors the original UserUpdateForm (email) + ProfileUpdateForm split;
 * rollNumber is immutable identity and is not updatable here.
 */
import {
  AuthErrorCode,
  type CollegeStatus,
  type MyCollegeResponse,
  type UpdateMeInput,
} from "@codeapt/shared";
import type { HydratedDocument } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { CollegeModel } from "../models/college.model.js";
import {
  ProfileModel,
  UserModel,
  type Profile,
  type User,
} from "../models/user.model.js";

type UserDoc = HydratedDocument<User>;
type ProfileDoc = HydratedDocument<Profile>;

async function loadMe(
  userId: string,
): Promise<{ user: UserDoc; profile: ProfileDoc }> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  const profile = await ProfileModel.findOne({ user: user._id });
  if (!profile) {
    throw new AppError("Profile not found", 500, "PROFILE_MISSING");
  }
  return { user, profile };
}

export function getMe(
  userId: string,
): Promise<{ user: UserDoc; profile: ProfileDoc }> {
  return loadMe(userId);
}

/**
 * The caller's own college membership, for routing them into their /c/:slug
 * space. Returns `{ college: null }` for individual users (and any user with no
 * `college` ref). Read-only; the true tenant boundary is still enforced by
 * resolveTenant on every /c/:slug route.
 */
export async function getMyCollege(userId: string): Promise<MyCollegeResponse> {
  const user = await UserModel.findById(userId).select("college");
  if (!user) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  if (!user.college) return { college: null };
  const college = await CollegeModel.findById(user.college).select(
    "name slug status",
  );
  if (!college) return { college: null };
  return {
    college: {
      id: college._id.toString(),
      name: college.name,
      slug: college.slug,
      status: college.status as CollegeStatus,
    },
  };
}

export async function updateMe(
  userId: string,
  input: UpdateMeInput,
): Promise<{ user: UserDoc; profile: ProfileDoc }> {
  const { user, profile } = await loadMe(userId);

  // User half: email only, with a uniqueness re-check on change.
  if (input.email && input.email !== user.email) {
    const taken = await UserModel.exists({
      email: input.email,
      _id: { $ne: user._id },
    });
    if (taken) {
      throw new AppError(
        "Email already in use",
        409,
        AuthErrorCode.EMAIL_TAKEN,
        {
          fields: { email: "Email is already registered" },
        },
      );
    }
    user.email = input.email;
    await user.save();
  }

  // Profile half.
  const profileFields: Partial<
    Pick<Profile, "fullName" | "collegeName" | "phoneNumber" | "state" | "bio">
  > = {};
  if (input.fullName !== undefined) profileFields.fullName = input.fullName;
  if (input.collegeName !== undefined)
    profileFields.collegeName = input.collegeName;
  if (input.phoneNumber !== undefined)
    profileFields.phoneNumber = input.phoneNumber;
  if (input.state !== undefined) profileFields.state = input.state;
  if (input.bio !== undefined) profileFields.bio = input.bio;

  if (Object.keys(profileFields).length > 0) {
    profile.set(profileFields);
    await profile.save();
  }

  return { user, profile };
}
