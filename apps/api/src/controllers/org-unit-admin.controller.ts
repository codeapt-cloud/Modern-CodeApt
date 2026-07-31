/**
 * OrgUnit controllers (college_admin within the tenant). Thin: validate with
 * shared zod schemas, delegate to the tenant-scoped org-unit service. The
 * college id comes from the validated `req.tenant` (set by resolveTenant),
 * never the client.
 */
import {
  bulkCreateOrgUnitsSchema,
  createOrgUnitSchema,
  TenantErrorCode,
  updateOrgUnitSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import * as orgUnits from "../services/org-unit.service.js";

function tenantCollegeId(req: Request): string {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant.college.id;
}

export const listOrgUnitsController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await orgUnits.listOrgUnitTree(tenantCollegeId(req));
    res.status(200).json({ items });
  },
);

export const createOrgUnitController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createOrgUnitSchema.parse(req.body);
    res.status(201).json(await orgUnits.createOrgUnit(tenantCollegeId(req), input));
  },
);

export const updateOrgUnitController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateOrgUnitSchema.parse(req.body);
    res
      .status(200)
      .json(
        await orgUnits.updateOrgUnit(
          tenantCollegeId(req),
          req.params.orgUnitId ?? "",
          input,
        ),
      );
  },
);

export const deleteOrgUnitController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await orgUnits.deleteOrgUnit(
          tenantCollegeId(req),
          req.params.orgUnitId ?? "",
        ),
      );
  },
);

export const bulkCreateOrgUnitsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = bulkCreateOrgUnitsSchema.parse(req.body);
    res
      .status(201)
      .json(await orgUnits.bulkCreateOrgUnits(tenantCollegeId(req), input));
  },
);
