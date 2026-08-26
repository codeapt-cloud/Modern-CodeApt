/**
 * Build the URL that launches a composite PART into its existing engine runner
 * (Step 25 C3/C5). Extracted from the runner page so the URL contract is unit-
 * testable in the node web suite.
 *
 * Every launch is ADDITIVE query params on the engine's own route:
 *  - `?c=<slug>` so the college exam/essay runners resolve the TENANT list+start
 *    (without it they hit the individual flow and can't find the paper);
 *  - `?from=<composite path>` so completion returns to the composite (C3);
 *  - speaking additionally gets `?assessment=<ref>` to auto-select the paper and
 *    skip the list-and-pick (C5).
 * A direct visit (none of these) behaves exactly as before.
 */
import type { CommunicationPartType } from "@codeapt/shared";

export function communicationRunnerPath(
  slug: string,
  partType: CommunicationPartType,
  ref: string,
  from: string,
): string {
  const back = `from=${encodeURIComponent(from)}`;
  const c = `c=${encodeURIComponent(slug)}`;
  if (partType === "exam") return `/exam/${ref}?${c}&${back}`;
  if (partType === "essay") return `/essays/${ref}?${c}&${back}`;
  return `/c/${slug}/speaking?assessment=${encodeURIComponent(ref)}&${back}`;
}

/**
 * The GLOBAL (B2C / any enrolled learner) variant — no slug (S30 B3). Each part
 * routes into its GLOBAL engine runner: `/exam/:ref`, `/essays/:ref`, and the new
 * slug-free `/speaking/:ref`. `?from=` returns to the composite exactly as the
 * college variant does; a direct visit (no `from`) behaves as before. The B2C
 * exam/essay flows are already enrollment-driven, so no `?c=` is needed.
 */
export function communicationRunnerPathGlobal(
  partType: CommunicationPartType,
  ref: string,
  from: string,
): string {
  const back = `from=${encodeURIComponent(from)}`;
  if (partType === "exam") return `/exam/${ref}?${back}`;
  if (partType === "essay") return `/essays/${ref}?${back}`;
  return `/speaking/${ref}?${back}`;
}
