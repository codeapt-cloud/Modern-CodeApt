/**
 * Serializers: Mongoose documents -> public API DTOs (@codeapt/shared).
 * Keeps sensitive fields (passwordHash, tokenVersion) out of responses and
 * normalizes ids/dates to strings for the wire.
 */
import type {
  PublicProfile,
  PublicUser,
  Role,
  UserType,
} from "@codeapt/shared";
import type { Types } from "mongoose";

interface UserLike {
  _id: Types.ObjectId;
  username: string;
  email: string;
  // Mongoose infers enum fields as `string`; the schema constrains it to Role.
  role: string;
  // Likewise constrained to UserType by the model (defaults to `individual`).
  userType: string;
  forcePasswordChange: boolean;
  isActive: boolean;
  createdAt?: Date;
}

interface ProfileLike {
  fullName: string;
  collegeName?: string | null;
  rollNumber: string;
  phoneNumber?: string | null;
  state?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
}

export function toPublicUser(user: UserLike): PublicUser {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role as Role,
    userType: user.userType as UserType,
    forcePasswordChange: user.forcePasswordChange,
    isActive: user.isActive,
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  };
}

export function toPublicProfile(profile: ProfileLike): PublicProfile {
  return {
    fullName: profile.fullName,
    collegeName: profile.collegeName ?? "",
    rollNumber: profile.rollNumber,
    phoneNumber: profile.phoneNumber ?? "",
    state: profile.state ?? "",
    bio: profile.bio ?? "",
    avatarUrl: profile.avatarUrl ?? "",
  };
}
