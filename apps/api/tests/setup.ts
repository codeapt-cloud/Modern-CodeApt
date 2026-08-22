/**
 * Test bootstrap. Runs BEFORE any test module imports the app, so required env
 * vars exist when config/env.ts loads. Uses an in-memory MongoDB per run and
 * wipes collections between tests for isolation.
 */
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeEach } from "vitest";

// Set env at top level (before the app/env module is evaluated).
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-0123456789abcdef";
process.env.JWT_ACCESS_TTL ??= "15m";
process.env.JWT_REFRESH_TTL ??= "30d";
process.env.REDIS_URL ??= "redis://localhost:6379";
// Pin the mock payment gateway so a local .env can't select phonepe in tests.
process.env.PAYMENT_GATEWAY = "mock";
process.env.PAYMENT_MOCK_SALT ??= "test-mock-salt";
// Cloudinary signed-upload creds (test-only). The secret value is asserted to
// NEVER appear in a signature response.
process.env.CLOUDINARY_CLOUD_NAME ??= "test-cloud";
process.env.CLOUDINARY_API_KEY ??= "test-api-key-123";
process.env.CLOUDINARY_API_SECRET ??= "test-secret-must-never-leak-xyz";
// LLM gateway secret-encryption key (test-only); asserted never to leak.
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789abcdef";

// NOTE: MongoMemoryServer spins up a SEPARATE mongod per test FILE, each writing
// its data to the OS temp dir (os.tmpdir()). Running the full suite (68 files)
// needs real disk there. If that drive is full, the failure surfaces as
// "MongoServerError: 28: No space left on device" scattered across UNRELATED
// files — misleading, since the tests themselves are fine. This repo lives on
// F: but temp defaults to C:; if C: is full, point the suite's temp at the repo
// drive: `TEMP=F:/tmp TMP=F:/tmp pnpm --filter @codeapt/api test`.
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
await mongoose.connect(process.env.MONGODB_URI);

beforeEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
