/**
 * Secret encryption at rest — AES-256-GCM.
 *
 * Provider API keys live ENCRYPTED in the DB; the encryption key comes from the
 * `ENCRYPTION_KEY` env var (stretched to a 32-byte key via SHA-256, so any
 * passphrase length is accepted). Ciphertext is stored as a single compact
 * string `v1:<iv>:<authTag>:<ciphertext>` (all base64) — self-describing and
 * versioned. GCM authenticates, so tampering fails decryption rather than
 * yielding garbage.
 *
 * SECURITY: plaintext is never logged and never returned to clients. Callers
 * decrypt only at the moment of use (the gateway, server-side). If
 * `ENCRYPTION_KEY` is unset, encrypt/decrypt throw a clear error — the gateway
 * checks `isEncryptionConfigured()` first and stays disabled rather than crash.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = "v1";

export function isEncryptionConfigured(): boolean {
  return Boolean(env.ENCRYPTION_KEY);
}

/** Derive a stable 32-byte key from the configured passphrase. */
function key(): Buffer {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured — cannot encrypt/decrypt secrets");
  }
  return createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

/** Encrypt a plaintext secret → `v1:<iv>:<authTag>:<ciphertext>` (base64 parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Decrypt a `v1:…` blob back to plaintext. Throws on a bad key / tampering. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed encrypted secret");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivB64!, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64!, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
