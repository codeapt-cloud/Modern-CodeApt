/**
 * Idempotent admin bootstrap. Admins cannot self-register, so this creates one
 * from env vars: ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD (required) plus
 * optional ADMIN_FULL_NAME / ADMIN_ROLL_NUMBER.
 *
 *   pnpm --filter @codeapt/api seed:admin
 *
 * Re-running is safe: if the admin already exists it is left in place (role is
 * ensured to be admin) and no duplicate is created.
 */
import { Role } from "@codeapt/shared";

import { env } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { ProfileModel, UserModel } from "../models/user.model.js";

async function seedAdmin(): Promise<void> {
  const username = env.ADMIN_USERNAME;
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;

  if (!username || !email || !password) {
    logger.error(
      "seed:admin requires ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD",
    );
    process.exit(1);
  }

  await connectDatabase();
  try {
    const normalizedEmail = email.toLowerCase();
    const existing = await UserModel.findOne({
      $or: [{ email: normalizedEmail }, { username }],
    });

    if (existing) {
      if (existing.role !== Role.ADMIN) {
        existing.role = Role.ADMIN;
        await existing.save();
        logger.info(`Promoted existing user "${existing.username}" to admin`);
      } else {
        logger.info(
          `Admin "${existing.username}" already exists — nothing to do`,
        );
      }
      // Ensure a profile exists (GET /api/me needs one).
      const hasProfile = await ProfileModel.exists({ user: existing._id });
      if (!hasProfile) {
        await ProfileModel.create({
          user: existing._id,
          fullName: env.ADMIN_FULL_NAME ?? "Administrator",
          rollNumber: env.ADMIN_ROLL_NUMBER ?? "ADMIN-0001",
          avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(
            existing.username,
          )}&background=random`,
        });
        logger.info("Created missing admin profile");
      }
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await UserModel.create({
      username,
      email: normalizedEmail,
      passwordHash,
      role: Role.ADMIN,
      forcePasswordChange: false,
    });
    await ProfileModel.create({
      user: user._id,
      fullName: env.ADMIN_FULL_NAME ?? "Administrator",
      rollNumber: env.ADMIN_ROLL_NUMBER ?? "ADMIN-0001",
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(
        username,
      )}&background=random`,
    });
    logger.info(`Created admin user "${username}" <${normalizedEmail}>`);
  } finally {
    await disconnectDatabase();
  }
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error({ err }, "seed:admin failed");
    process.exit(1);
  });
