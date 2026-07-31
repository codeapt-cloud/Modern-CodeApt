/**
 * Verify legacy DJANGO password hashes (migration support).
 *
 * Migrated users arrive with passwords in Django's default format:
 *   pbkdf2_sha256$<iterations>$<salt>$<base64-hash>
 * so the auth layer must verify them, letting those users log in with their
 * EXISTING passwords. On a successful login the caller transparently re-hashes
 * to the native scheme (argon2id), so Django hashes fade out over time.
 *
 * node:crypto only — Django's default is PBKDF2-HMAC-SHA256, which
 * `pbkdf2Sync` covers; `timingSafeEqual` gives the constant-time compare. No
 * new dependency. Only `pbkdf2_sha256` is handled; any other Django algorithm
 * prefix fails CLOSED (returns false) rather than guessing.
 */
import { pbkdf2Sync, timingSafeEqual } from "node:crypto";

const DJANGO_PREFIX = "pbkdf2_sha256$";

/** Cheap prefix check used to route the login verification. */
export function isDjangoPasswordHash(encoded: string): boolean {
  return encoded.startsWith(DJANGO_PREFIX);
}

/**
 * Return true iff `plain` matches the Django-encoded `pbkdf2_sha256` hash.
 * Robust to malformed input: any parse/format problem returns false — it never
 * throws. Salt is used as UTF-8 (as Django stores it); the derived-key length
 * is taken from the decoded stored hash so the PBKDF2 output length is exact.
 */
export function verifyDjangoPassword(plain: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 4) return false;

  const [algorithm, iterationsRaw, salt, storedB64] = parts;
  if (algorithm !== "pbkdf2_sha256") return false; // fail closed on other algos
  if (!salt || !storedB64) return false;

  const iterations = Number.parseInt(iterationsRaw ?? "", 10);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  // Decode the stored hash; its byte length drives the PBKDF2 keylen (32 for
  // sha256). Buffer.from is lenient, so guard against an empty/garbage decode.
  const expected = Buffer.from(storedB64, "base64");
  if (expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = pbkdf2Sync(plain, salt, iterations, expected.length, "sha256");
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;

  return timingSafeEqual(derived, expected);
}
