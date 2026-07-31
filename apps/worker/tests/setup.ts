/**
 * Worker test bootstrap. Sets required env BEFORE config/env.ts is evaluated so
 * importing modules that read env (e.g. the Piston client) does not fail-fast.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.MONGODB_URI ??= "mongodb://localhost:27017/codeapt-test";
process.env.PISTON_URL ??= "https://2b9xkx83-2000.inc1.devtunnels.ms";
process.env.PISTON_TIMEOUT_MS ??= "5000";
// Force the real HTTP path (the piston tests stub fetch). Pin this so a local
// .env with PISTON_MOCK=true can't leak in via dotenv and bypass the stub.
process.env.PISTON_MOCK = "false";
// Pin the essay AI provider so a local .env can't change grader selection.
process.env.ESSAY_AI_PROVIDER = "mock";
process.env.ESSAY_AI_TIMEOUT_MS = "5000";
