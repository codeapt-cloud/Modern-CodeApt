/**
 * Tiny deterministic PRNG for the game seam. `Math.random` is not seedable, so
 * the same seed must yield the same game instance on server AND client — we
 * hash a string seed to a uint32 (xmur3) and feed a mulberry32 generator. No
 * dependency, no I/O; pure and unit-testable.
 *
 * Not cryptographic — it exists for reproducibility, never for secrecy. The
 * solution is stripped from the client view regardless, so seeing the seed
 * never lets a client compute the answer.
 */

/** xmur3 string → seed hash: produces a well-mixed uint32 from any string. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32: fast, well-distributed 32-bit PRNG. Returns floats in [0, 1). */
function mulberry32(seedUint32: number): () => number {
  let a = seedUint32 >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stateful random source: call it for the next float in [0, 1). */
export type Rng = () => number;

/** Build a deterministic Rng from a string seed. Same seed → same sequence. */
export function createRng(seed: string): Rng {
  return mulberry32(xmur3(seed)());
}

/** Integer in [minInclusive, maxInclusive]. */
export function rngInt(
  rng: Rng,
  minInclusive: number,
  maxInclusive: number,
): number {
  const lo = Math.ceil(minInclusive);
  const hi = Math.floor(maxInclusive);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** A new array with `items` Fisher-Yates shuffled deterministically. */
export function rngShuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
