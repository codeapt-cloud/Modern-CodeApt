/**
 * Password hashing with argon2id. Plaintext is never stored or logged.
 *
 * argon2id resists both GPU and side-channel attacks; we use the library
 * defaults (memoryCost 64 MiB, timeCost 3, parallelism 4) which are a sound
 * baseline for interactive logins. `hash` embeds the salt + params in the
 * output string, so `verify` needs no separate salt storage.
 */
import argon2 from "argon2";

const HASH_OPTIONS: argon2.Options = { type: argon2.argon2id };

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash etc. — treat as a non-match rather than throwing.
    return false;
  }
}
