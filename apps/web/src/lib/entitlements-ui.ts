/**
 * Pure helpers that turn a college's entitlements + the SHARED catalog
 * (CollegeFeature + SUB_CAPABILITY_CATALOG) into the toggle tree the college
 * console renders. Driven entirely by the shared catalog — adding a feature or
 * sub-capability there needs NO change here or in the UI. No React/DOM, so it
 * unit-tests cleanly.
 */
import {
  COLLEGE_FEATURE_VALUES,
  SUB_CAPABILITY_CATALOG,
  subCapabilityKey,
  type CollegeEntitlements,
  type CollegeFeature,
} from "@codeapt/shared";

const ACRONYMS = new Set(["ai"]);

/** "bulk_import" → "Bulk Import", "ai_grading" → "AI Grading". */
export function humanizeKey(raw: string): string {
  return raw
    .split(/[_.\s]+/)
    .map((w) =>
      ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

export interface SubCapabilityNode {
  /** Dotted catalog key, e.g. "exams.public_links". */
  key: string;
  /** Bare sub-capability name, e.g. "public_links". */
  sub: string;
  label: string;
  enabled: boolean;
  /** True when the parent feature is OFF (a sub-cap needs its feature on). */
  disabled: boolean;
}

export interface FeatureNode {
  key: CollegeFeature;
  label: string;
  enabled: boolean;
  subCapabilities: SubCapabilityNode[];
}

/**
 * Build the full feature → sub-capability toggle tree for a college. Every
 * FEATURE in the catalog is present; each carries its catalog sub-capabilities
 * with their stored state and a `disabled` flag (true when the feature is off).
 */
export function buildEntitlementTree(
  entitlements: CollegeEntitlements,
): FeatureNode[] {
  return COLLEGE_FEATURE_VALUES.map((feature) => {
    const enabled = entitlements.features[feature] === true;
    const subCapabilities: SubCapabilityNode[] = (
      SUB_CAPABILITY_CATALOG[feature] ?? []
    ).map((sub) => {
      const key = subCapabilityKey(feature, sub);
      return {
        key,
        sub,
        label: humanizeKey(sub),
        enabled: entitlements.subCapabilities[key] === true,
        disabled: !enabled,
      };
    });
    return {
      key: feature,
      label: humanizeKey(feature),
      enabled,
      subCapabilities,
    };
  });
}

/** How many of the catalog features are enabled (for list summaries). */
export function enabledFeatureCount(entitlements: CollegeEntitlements): number {
  return COLLEGE_FEATURE_VALUES.filter(
    (f) => entitlements.features[f] === true,
  ).length;
}

/** Total number of features in the catalog (denominator for "N / M"). */
export const TOTAL_FEATURE_COUNT = COLLEGE_FEATURE_VALUES.length;
