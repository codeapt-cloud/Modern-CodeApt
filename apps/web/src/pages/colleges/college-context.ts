/**
 * Shared outlet-context contract for the college workspace. Child pages read the
 * resolved tenant context via `useCollege()`. Kept separate from CollegeLayout so
 * that file only exports a component (fast-refresh friendly).
 */
import type { CollegeContextResponse } from "@codeapt/shared";
import { useOutletContext } from "react-router-dom";

/** What every page rendered inside the college space receives. */
export interface CollegeOutletContext {
  slug: string;
  context: CollegeContextResponse;
  /** Re-fetch the tenant context (e.g. after an entitlement-relevant change). */
  refetchContext: () => void;
}

/** Typed accessor for child pages: `const { slug, context } = useCollege();` */
export function useCollege(): CollegeOutletContext {
  return useOutletContext<CollegeOutletContext>();
}
