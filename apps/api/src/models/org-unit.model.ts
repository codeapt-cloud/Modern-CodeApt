/**
 * OrgUnit — a node in a college's academic structure tree (department / year /
 * section / semester). Phase 2 of the multi-tenant upgrade.
 *
 * ALWAYS tenant-scoped: `college` is required, and every query/write goes
 * through the tenant-scope helper (lib/tenant-scope.ts) so one college can never
 * touch another's structure. The tree is flexible — `parent=null` is a root
 * unit, and nesting is validated in the service via the shared `canNestUnder`
 * rule (not a fixed depth).
 *
 * Uniqueness is TENANT-SCOPED and additive: a name must be unique among its
 * siblings (same college + same parent). This introduces no global index and
 * does not touch any existing collection. See docs/MULTI_TENANT_ARCHITECTURE.md.
 */
import { Schema, model, type InferSchemaType } from "mongoose";
import { ORG_UNIT_TYPE_VALUES } from "@codeapt/shared";

const orgUnitSchema = new Schema(
  {
    college: {
      type: Schema.Types.ObjectId,
      ref: "College",
      required: true,
    },
    type: { type: String, enum: ORG_UNIT_TYPE_VALUES, required: true },
    name: { type: String, required: true, trim: true },
    // null → a root-level unit (e.g. a department).
    parent: { type: Schema.Types.ObjectId, ref: "OrgUnit", default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Tree reads within a tenant.
orgUnitSchema.index({ college: 1, parent: 1, type: 1 });
// Sibling-name uniqueness within a tenant (college + parent + name). `parent`
// null is a real value here, so two root units in one college can't share a
// name. Scoped by college, so different colleges are independent.
orgUnitSchema.index({ college: 1, parent: 1, name: 1 }, { unique: true });

export type OrgUnit = InferSchemaType<typeof orgUnitSchema>;
export const OrgUnitModel = model("OrgUnit", orgUnitSchema);
