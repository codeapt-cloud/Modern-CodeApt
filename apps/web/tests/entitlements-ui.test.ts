/**
 * Pure entitlement-tree UI logic (Phase 1). Proves the console's feature →
 * sub-capability toggle tree is derived from the SHARED catalog and that
 * disabled/enabled states are correct — the logic the control panel renders.
 */
import {
  buildDefaultEntitlements,
  COLLEGE_FEATURE_VALUES,
  CollegeFeature,
  SUB_CAPABILITY_CATALOG,
  subCapabilityKey,
  type CollegeEntitlements,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  buildEntitlementTree,
  enabledFeatureCount,
  humanizeKey,
  TOTAL_FEATURE_COUNT,
} from "../src/lib/entitlements-ui.js";

describe("humanizeKey", () => {
  it("title-cases keys and uppercases known acronyms", () => {
    expect(humanizeKey("exams")).toBe("Exams");
    expect(humanizeKey("bulk_import")).toBe("Bulk Import");
    expect(humanizeKey("public_links")).toBe("Public Links");
    expect(humanizeKey("ai_grading")).toBe("AI Grading");
  });
});

describe("buildEntitlementTree", () => {
  it("is driven entirely by the shared catalog (all features + their sub-caps)", () => {
    const tree = buildEntitlementTree(buildDefaultEntitlements());
    // One node per catalog feature, in catalog order.
    expect(tree.map((n) => n.key)).toEqual([...COLLEGE_FEATURE_VALUES]);
    expect(tree).toHaveLength(TOTAL_FEATURE_COUNT);
    // Each feature carries exactly its catalog sub-capabilities (dotted keys).
    for (const node of tree) {
      const expected = (SUB_CAPABILITY_CATALOG[node.key] ?? []).map((s) =>
        subCapabilityKey(node.key, s),
      );
      expect(node.subCapabilities.map((sc) => sc.key)).toEqual(expected);
    }
  });

  it("defaults: everything off, every sub-cap disabled (parent off)", () => {
    const tree = buildEntitlementTree(buildDefaultEntitlements());
    expect(tree.every((n) => n.enabled === false)).toBe(true);
    expect(
      tree.every((n) => n.subCapabilities.every((sc) => sc.disabled === true)),
    ).toBe(true);
  });

  it("enabling a feature enables its sub-cap toggles; sub-cap value reflects entitlements", () => {
    const e: CollegeEntitlements = buildDefaultEntitlements();
    e.features[CollegeFeature.EXAMS] = true;
    e.subCapabilities[subCapabilityKey(CollegeFeature.EXAMS, "public_links")] =
      true;

    const tree = buildEntitlementTree(e);
    const exams = tree.find((n) => n.key === CollegeFeature.EXAMS)!;
    expect(exams.enabled).toBe(true);

    const publicLinks = exams.subCapabilities.find(
      (sc) => sc.sub === "public_links",
    )!;
    expect(publicLinks.disabled).toBe(false); // parent on → interactive
    expect(publicLinks.enabled).toBe(true);

    const bulkUpload = exams.subCapabilities.find(
      (sc) => sc.sub === "bulk_upload",
    )!;
    expect(bulkUpload.disabled).toBe(false);
    expect(bulkUpload.enabled).toBe(false); // not granted

    // A different, still-off feature keeps its sub-caps disabled.
    const essays = tree.find((n) => n.key === CollegeFeature.ESSAYS)!;
    expect(essays.enabled).toBe(false);
    expect(essays.subCapabilities.every((sc) => sc.disabled)).toBe(true);
  });
});

describe("enabledFeatureCount", () => {
  it("counts only enabled features", () => {
    const e = buildDefaultEntitlements();
    expect(enabledFeatureCount(e)).toBe(0);
    e.features[CollegeFeature.COURSES] = true;
    e.features[CollegeFeature.EXAMS] = true;
    e.features[CollegeFeature.ESSAYS] = false;
    expect(enabledFeatureCount(e)).toBe(2);
    expect(TOTAL_FEATURE_COUNT).toBe(COLLEGE_FEATURE_VALUES.length);
  });
});
