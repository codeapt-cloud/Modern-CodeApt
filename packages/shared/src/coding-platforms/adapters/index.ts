/**
 * Adapter registry — one module per platform, looked up by `CodingPlatform`.
 * Mirrors the LLM gateway's `adapters/index.ts` (a Record + a safe lookup).
 */
import { CodingPlatform } from "../../enums.js";
import type { CodingPlatformAdapter } from "../types.js";
import { codechefAdapter } from "./codechef.js";
import { codeforcesAdapter } from "./codeforces.js";
import { leetcodeAdapter } from "./leetcode.js";

export const CODING_ADAPTERS: Record<CodingPlatform, CodingPlatformAdapter> = {
  [CodingPlatform.CODEFORCES]: codeforcesAdapter,
  [CodingPlatform.LEETCODE]: leetcodeAdapter,
  [CodingPlatform.CODECHEF]: codechefAdapter,
};

export function codingAdapterFor(platform: CodingPlatform): CodingPlatformAdapter {
  return CODING_ADAPTERS[platform];
}
