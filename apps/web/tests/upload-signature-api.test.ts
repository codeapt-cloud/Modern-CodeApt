/**
 * Fix #3 client wiring. The college exam/careers editors inject
 * `() => api.uploads.collegeSignature(slug)` into the shared
 * QuestionEditorDialog / PostingEditorDialog so a college_admin/faculty's image
 * upload hits the TENANT signature route (not the platform-admin one that 403s
 * them). Rendering the dialogs needs no harness here — the prop threading itself
 * is covered by typecheck — so this proves the part with real branching risk:
 * that the injected fetcher resolves to the tenant route, and the default the
 * dialog falls back to still resolves to the admin route (unchanged).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, http } from "../src/lib/api-client.js";

describe("upload-signature api-client wiring (fix #3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("collegeSignature(slug) POSTs to the TENANT route /c/:slug/uploads/signature", async () => {
    const post = vi
      .spyOn(http, "post")
      .mockResolvedValue({ data: {} } as never);
    await api.uploads.collegeSignature("acme");
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining("/c/acme/uploads/signature"),
    );
  });

  it("the default signature() still POSTs to the platform-admin route (unchanged)", async () => {
    const post = vi
      .spyOn(http, "post")
      .mockResolvedValue({ data: {} } as never);
    await api.uploads.signature();
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/uploads/signature"),
    );
  });
});
