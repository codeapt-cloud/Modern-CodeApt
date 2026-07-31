/**
 * OrgUnit service (Phase 2) — CRUD + tree + bulk-create for a college's academic
 * structure. EVERY read/write goes through createTenantScope(collegeId), so no
 * query can cross a tenant boundary. Nesting is validated with the shared
 * `canNestUnder` rule; re-parenting is cycle-checked; delete is blocked while a
 * unit still has children.
 *
 * Phase 3 seam: when college students exist, delete must ALSO block a unit that
 * has students assigned (student.orgUnit). Noted, not built here.
 */
import {
  canNestUnder,
  OrgUnitErrorCode,
  Role,
  type BulkCreateOrgUnitsInput,
  type BulkCreateOrgUnitsResponse,
  type CreateOrgUnitInput,
  type OrgUnit as OrgUnitDTO,
  type OrgUnitTreeNode,
  type OrgUnitType,
  type UpdateOrgUnitInput,
} from "@codeapt/shared";
import { Types } from "mongoose";

import { AppError } from "../errors/app-error.js";
import { createTenantScope, type TenantScope } from "../lib/tenant-scope.js";
import { OrgUnitModel } from "../models/org-unit.model.js";
import { UserModel } from "../models/user.model.js";

type OrgUnitDoc = InstanceType<typeof OrgUnitModel>;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === 11000
  );
}

function toDTO(u: OrgUnitDoc): OrgUnitDTO {
  return {
    id: u._id.toString(),
    type: u.type as OrgUnitType,
    name: u.name,
    parentId: u.parent ? u.parent.toString() : null,
    order: u.order ?? 0,
  };
}

async function getScopedOrThrow(
  scope: TenantScope,
  id: string,
): Promise<OrgUnitDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(
      "Org unit not found",
      404,
      OrgUnitErrorCode.ORG_UNIT_NOT_FOUND,
    );
  }
  const unit = await OrgUnitModel.findOne(scope.filter({ _id: id }));
  if (!unit) {
    throw new AppError(
      "Org unit not found",
      404,
      OrgUnitErrorCode.ORG_UNIT_NOT_FOUND,
    );
  }
  return unit;
}

/**
 * Validate a prospective parent for a child of `childType`. null → root (any
 * type allowed). Otherwise the parent must exist IN THIS TENANT and the
 * parent→child nesting must be permitted. Returns the parent's ObjectId (or
 * null for root).
 */
async function resolveParent(
  scope: TenantScope,
  parentId: string | null | undefined,
  childType: OrgUnitType,
): Promise<Types.ObjectId | null> {
  if (!parentId) return null;
  if (!Types.ObjectId.isValid(parentId)) {
    throw new AppError(
      "Invalid parent unit",
      400,
      OrgUnitErrorCode.ORG_UNIT_INVALID_PARENT,
    );
  }
  const parent = await OrgUnitModel.findOne(scope.filter({ _id: parentId }));
  if (!parent) {
    throw new AppError(
      "Parent unit not found in this college",
      400,
      OrgUnitErrorCode.ORG_UNIT_INVALID_PARENT,
    );
  }
  if (!canNestUnder(parent.type as OrgUnitType, childType)) {
    throw new AppError(
      `A ${childType} cannot nest under a ${parent.type}`,
      400,
      OrgUnitErrorCode.ORG_UNIT_INVALID_PARENT,
    );
  }
  return parent._id;
}

/** Would setting `newParentId` as the parent of `nodeId` create a cycle? */
async function wouldCreateCycle(
  scope: TenantScope,
  nodeId: Types.ObjectId,
  newParentId: Types.ObjectId,
): Promise<boolean> {
  const target = nodeId.toString();
  let cursor: Types.ObjectId | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    const cur = cursor.toString();
    if (cur === target) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    const parent: OrgUnitDoc | null = await OrgUnitModel.findOne(
      scope.filter({ _id: cursor }),
    ).select("parent");
    cursor = parent?.parent ?? null;
  }
  return false;
}

export async function createOrgUnit(
  collegeId: string,
  input: CreateOrgUnitInput,
): Promise<OrgUnitDTO> {
  const scope = createTenantScope(collegeId);
  const parent = await resolveParent(scope, input.parentId ?? null, input.type);
  try {
    const created = await OrgUnitModel.create(
      scope.attach({
        type: input.type,
        name: input.name,
        parent,
        order: input.order ?? 0,
      }),
    );
    return toDTO(created);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        `A sibling unit named "${input.name}" already exists`,
        409,
        OrgUnitErrorCode.ORG_UNIT_NAME_TAKEN,
      );
    }
    throw err;
  }
}

export async function updateOrgUnit(
  collegeId: string,
  id: string,
  input: UpdateOrgUnitInput,
): Promise<OrgUnitDTO> {
  const scope = createTenantScope(collegeId);
  const unit = await getScopedOrThrow(scope, id);

  if (input.parentId !== undefined) {
    if (input.parentId === null) {
      unit.parent = null; // move to root
    } else {
      if (!Types.ObjectId.isValid(input.parentId)) {
        throw new AppError(
          "Invalid parent unit",
          400,
          OrgUnitErrorCode.ORG_UNIT_INVALID_PARENT,
        );
      }
      const parent = await OrgUnitModel.findOne(
        scope.filter({ _id: input.parentId }),
      );
      if (!parent) {
        throw new AppError(
          "Parent unit not found in this college",
          400,
          OrgUnitErrorCode.ORG_UNIT_INVALID_PARENT,
        );
      }
      // Cycle checks BEFORE the nesting-type check: re-parenting onto self or a
      // descendant is a cycle regardless of types.
      if (parent._id.equals(unit._id)) {
        throw new AppError(
          "A unit cannot be its own parent",
          400,
          OrgUnitErrorCode.ORG_UNIT_CYCLE,
        );
      }
      if (await wouldCreateCycle(scope, unit._id, parent._id)) {
        throw new AppError(
          "Re-parenting would create a cycle",
          400,
          OrgUnitErrorCode.ORG_UNIT_CYCLE,
        );
      }
      if (!canNestUnder(parent.type as OrgUnitType, unit.type as OrgUnitType)) {
        throw new AppError(
          `A ${unit.type} cannot nest under a ${parent.type}`,
          400,
          OrgUnitErrorCode.ORG_UNIT_INVALID_PARENT,
        );
      }
      unit.parent = parent._id;
    }
  }
  if (input.name !== undefined) unit.name = input.name;
  if (input.order !== undefined) unit.order = input.order;

  try {
    await unit.save();
    return toDTO(unit);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(
        `A sibling unit named "${unit.name}" already exists`,
        409,
        OrgUnitErrorCode.ORG_UNIT_NAME_TAKEN,
      );
    }
    throw err;
  }
}

export async function deleteOrgUnit(
  collegeId: string,
  id: string,
): Promise<{ deleted: true }> {
  const scope = createTenantScope(collegeId);
  const unit = await getScopedOrThrow(scope, id);

  const childCount = await OrgUnitModel.countDocuments(
    scope.filter({ parent: unit._id }),
  );
  if (childCount > 0) {
    throw new AppError(
      "Cannot delete a unit that still has child units",
      409,
      OrgUnitErrorCode.ORG_UNIT_HAS_CHILDREN,
      { children: childCount },
    );
  }
  // Phase 3: also block when college students are assigned to this unit. The
  // count is tenant-scoped (so it can only see THIS college's students).
  const studentCount = await UserModel.countDocuments(
    scope.filter({ orgUnit: unit._id, role: Role.STUDENT }),
  );
  if (studentCount > 0) {
    throw new AppError(
      "Cannot delete a unit that still has students assigned",
      409,
      OrgUnitErrorCode.ORG_UNIT_HAS_STUDENTS,
      { students: studentCount },
    );
  }
  await OrgUnitModel.deleteOne(scope.filter({ _id: unit._id }));
  return { deleted: true };
}

export async function listOrgUnitTree(
  collegeId: string,
): Promise<OrgUnitTreeNode[]> {
  const scope = createTenantScope(collegeId);
  const units = await OrgUnitModel.find(scope.filter()).sort({
    order: 1,
    name: 1,
  });

  const byId = new Map<string, OrgUnitTreeNode>();
  for (const u of units) {
    byId.set(u._id.toString(), { ...toDTO(u), children: [] });
  }
  const roots: OrgUnitTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function bulkCreateOrgUnits(
  collegeId: string,
  input: BulkCreateOrgUnitsInput,
): Promise<BulkCreateOrgUnitsResponse> {
  const scope = createTenantScope(collegeId);
  const parent = await resolveParent(scope, input.parentId ?? null, input.type);

  // Existing sibling names under this parent (any type — uniqueness is per
  // college+parent+name).
  const existing = await OrgUnitModel.find(
    scope.filter({ parent }),
  ).select("name");
  const existingNames = new Set(existing.map((u) => u.name));

  const created: OrgUnitDTO[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let order = existing.length;

  for (const name of input.names) {
    if (existingNames.has(name) || seen.has(name)) {
      skipped.push(name);
      continue;
    }
    seen.add(name);
    try {
      const doc = await OrgUnitModel.create(
        scope.attach({ type: input.type, name, parent, order }),
      );
      created.push(toDTO(doc));
      order += 1;
    } catch (err) {
      // A concurrent create raced us to this sibling name — treat as skipped.
      if (isDuplicateKeyError(err)) skipped.push(name);
      else throw err;
    }
  }
  return { created, skipped };
}
