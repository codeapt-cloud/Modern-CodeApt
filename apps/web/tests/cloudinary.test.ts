/**
 * imageUrl() — expands bare Cloudinary public-ids (migrated Django data) to full
 * delivery URLs while passing existing full URLs (and local/static paths)
 * through unchanged. CLOUD_NAME is read at module eval, so each case stubs the
 * env and re-imports a fresh module copy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadImageUrl(cloud: string) {
  vi.stubEnv("VITE_CLOUDINARY_CLOUD_NAME", cloud);
  vi.resetModules();
  const mod = await import("../src/lib/cloudinary.js");
  return mod.imageUrl;
}

afterEach(() => vi.unstubAllEnvs());

describe("imageUrl", () => {
  it("expands a bare Cloudinary public-id to a full delivery URL", async () => {
    const imageUrl = await loadImageUrl("dsut5kquw");
    expect(imageUrl("subjects/generated-image_2_shtcct")).toBe(
      "https://res.cloudinary.com/dsut5kquw/image/upload/subjects/generated-image_2_shtcct",
    );
  });

  it("passes full http/https URLs through unchanged", async () => {
    const imageUrl = await loadImageUrl("dsut5kquw");
    expect(imageUrl("https://res.cloudinary.com/x/image/upload/a.png")).toBe(
      "https://res.cloudinary.com/x/image/upload/a.png",
    );
    expect(imageUrl("http://example.com/logo.png")).toBe(
      "http://example.com/logo.png",
    );
    // ui-avatars-style full URLs (avatars) pass through too.
    expect(imageUrl("https://ui-avatars.com/api/?name=A")).toBe(
      "https://ui-avatars.com/api/?name=A",
    );
  });

  it("passes leading-slash local/static paths through unchanged", async () => {
    const imageUrl = await loadImageUrl("dsut5kquw");
    expect(imageUrl("/static/x.png")).toBe("/static/x.png");
  });

  it("returns '' for empty / nullish refs", async () => {
    const imageUrl = await loadImageUrl("dsut5kquw");
    expect(imageUrl("")).toBe("");
    expect(imageUrl(null)).toBe("");
    expect(imageUrl(undefined)).toBe("");
  });
});
