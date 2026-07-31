/**
 * Ambient augmentation:
 *  - `req.auth`   — populated by requireAuth (identity + tenant membership).
 *  - `req.tenant` — populated by resolveTenant on /c/:collegeSlug routes (the
 *                   validated college context + its entitlements).
 */
import type {
  CollegeEntitlements,
  CollegeStatus,
  Role,
  UserType,
} from "@codeapt/shared";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
        forcePasswordChange: boolean;
        /** Population type — `individual` (B2C/platform) or `college`. */
        userType: UserType;
        /** The user's college (tenant) id, or null for individual users. */
        college: string | null;
      };
      /**
       * The resolved + VALIDATED tenant for a /c/:collegeSlug request. Present
       * only after resolveTenant has run and confirmed the caller may act on
       * this college (member, or platform admin). Never trust a college id
       * from the client without this.
       */
      tenant?: {
        college: {
          id: string;
          slug: string;
          name: string;
          status: CollegeStatus;
        };
        entitlements: CollegeEntitlements;
        /** The caller's authority in this tenant context. */
        role: Role;
      };
      /** Raw request body bytes, captured for signature-verified webhooks. */
      rawBody?: string;
    }
  }
}

export {};
