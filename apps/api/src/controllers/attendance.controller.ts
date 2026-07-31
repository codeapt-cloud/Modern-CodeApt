/**
 * Attendance controllers (Prompt 1) — thin: validate with shared zod schemas,
 * delegate to the tenant-scoped attendance service. The college id comes from
 * the validated `req.tenant`; the ACTOR (for faculty scope) from `req.auth`.
 * Both are guaranteed by the route stack (requireAuth → resolveTenant).
 *
 * The Excel roll-number upload arrives as base64 in the JSON body (the same
 * pattern as the exam/roster importers — no multer); the preview endpoint parses
 * it and returns matched/unmatched WITHOUT persisting anything.
 */
import {
  AuthErrorCode,
  TenantErrorCode,
  addAttendanceMembersSchema,
  attendanceImportPreviewRequestSchema,
  createAttendanceGroupSchema,
  createAttendanceSessionSchema,
  saveAttendanceSchema,
  setAttendanceSettingsSchema,
  updateAttendanceGroupSchema,
  updateAttendanceSessionSchema,
} from "@codeapt/shared";
import type { Request, Response } from "express";

import { AppError } from "../errors/app-error.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  buildAttendanceTemplateWorkbook,
  parseAttendanceRollNumbers,
} from "../lib/attendance-excel.js";
import { sendXlsxAttachment } from "../lib/http-download.js";
import {
  buildRegisterWorkbook,
  buildSummaryWorkbook,
} from "../lib/attendance-report.js";
import * as attendance from "../services/attendance.service.js";
import type { AttendanceActor } from "../services/attendance.service.js";
import * as sessions from "../services/attendance-session.service.js";
import * as analytics from "../services/attendance-analytics.service.js";

function tenantId(req: Request): string {
  if (!req.tenant) {
    throw new AppError(
      "A college (tenant) context is required",
      500,
      TenantErrorCode.TENANT_CONTEXT_REQUIRED,
    );
  }
  return req.tenant.college.id;
}

function actor(req: Request): AttendanceActor {
  if (!req.auth) {
    throw new AppError(
      "Authentication required",
      401,
      AuthErrorCode.UNAUTHENTICATED,
    );
  }
  return { userId: req.auth.userId, role: req.auth.role };
}

// --- Groups ------------------------------------------------------------------

export const listAttendanceGroupsController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await attendance.listAttendanceGroups(tenantId(req), actor(req));
    res.status(200).json({ items });
  },
);

export const createAttendanceGroupController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createAttendanceGroupSchema.parse(req.body);
    res
      .status(201)
      .json(
        await attendance.createAttendanceGroup(tenantId(req), actor(req), input),
      );
  },
);

export const getAttendanceGroupController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await attendance.getAttendanceGroup(
          tenantId(req),
          actor(req),
          req.params.groupId ?? "",
        ),
      );
  },
);

export const updateAttendanceGroupController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateAttendanceGroupSchema.parse(req.body);
    res
      .status(200)
      .json(
        await attendance.updateAttendanceGroup(
          tenantId(req),
          actor(req),
          req.params.groupId ?? "",
          input,
        ),
      );
  },
);

export const deleteAttendanceGroupController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await attendance.deleteAttendanceGroup(
          tenantId(req),
          actor(req),
          req.params.groupId ?? "",
        ),
      );
  },
);

// --- Members -----------------------------------------------------------------

export const addAttendanceMembersController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = addAttendanceMembersSchema.parse(req.body);
    res
      .status(200)
      .json(
        await attendance.addAttendanceMembers(
          tenantId(req),
          actor(req),
          req.params.groupId ?? "",
          input,
        ),
      );
  },
);

export const removeAttendanceMemberController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await attendance.removeAttendanceMember(
          tenantId(req),
          actor(req),
          req.params.groupId ?? "",
          req.params.studentId ?? "",
        ),
      );
  },
);

// --- Excel roll-number preview + template ------------------------------------

export const attendanceImportPreviewController = asyncHandler(
  async (req: Request, res: Response) => {
    const { fileBase64 } = attendanceImportPreviewRequestSchema.parse(req.body);
    const buffer = Buffer.from(fileBase64, "base64");
    const rollNumbers = await parseAttendanceRollNumbers(buffer);
    res
      .status(200)
      .json(
        await attendance.previewAttendanceRollNumbers(tenantId(req), rollNumbers),
      );
  },
);

export const attendanceImportTemplateController = asyncHandler(
  async (_req: Request, res: Response) => {
    const buffer = await buildAttendanceTemplateWorkbook();
    sendXlsxAttachment(res, buffer, "attendance-roll-numbers-template.xlsx");
  },
);

// --- Settings (college-level cross-cutting permission) -----------------------

export const getAttendanceSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await attendance.getAttendanceSettings(tenantId(req)));
  },
);

export const setAttendanceSettingsController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = setAttendanceSettingsSchema.parse(req.body);
    res
      .status(200)
      .json(await attendance.setAttendanceSettings(tenantId(req), input));
  },
);

// --- Sessions + taking attendance (Prompt 2) ---------------------------------

export const listAttendanceSessionsController = asyncHandler(
  async (req: Request, res: Response) => {
    const items = await sessions.listSessions(
      tenantId(req),
      actor(req),
      req.params.groupId ?? "",
    );
    res.status(200).json({ items });
  },
);

export const createAttendanceSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = createAttendanceSessionSchema.parse(req.body);
    res
      .status(201)
      .json(
        await sessions.createSession(
          tenantId(req),
          actor(req),
          req.params.groupId ?? "",
          input,
        ),
      );
  },
);

export const getAttendanceSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await sessions.getSessionRoster(
          tenantId(req),
          actor(req),
          req.params.sessionId ?? "",
        ),
      );
  },
);

export const updateAttendanceSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = updateAttendanceSessionSchema.parse(req.body);
    res
      .status(200)
      .json(
        await sessions.updateSession(
          tenantId(req),
          actor(req),
          req.params.sessionId ?? "",
          input,
        ),
      );
  },
);

export const deleteAttendanceSessionController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await sessions.deleteSession(
          tenantId(req),
          actor(req),
          req.params.sessionId ?? "",
        ),
      );
  },
);

export const saveAttendanceController = asyncHandler(
  async (req: Request, res: Response) => {
    const input = saveAttendanceSchema.parse(req.body);
    res
      .status(200)
      .json(
        await sessions.saveAttendance(
          tenantId(req),
          actor(req),
          req.params.sessionId ?? "",
          input,
        ),
      );
  },
);

// --- Analytics + Excel reports (Prompt 3) ------------------------------------

/** Parse a positive %-threshold from the query (else the shared default). */
function threshold(req: Request): number | undefined {
  const raw = Number(req.query.threshold);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

export const attendanceAnalyticsController = asyncHandler(
  async (req: Request, res: Response) => {
    res
      .status(200)
      .json(
        await analytics.getAttendanceAnalytics(
          tenantId(req),
          actor(req),
          threshold(req),
        ),
      );
  },
);

export const attendanceRegisterReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await analytics.groupRegisterData(
      tenantId(req),
      actor(req),
      str(req.query.groupId) ?? "",
    );
    const buffer = await buildRegisterWorkbook(data);
    const safe = data.groupName.replace(/[^\w-]+/g, "_").slice(0, 40) || "group";
    sendXlsxAttachment(res, buffer, `attendance-register-${safe}.xlsx`);
  },
);

export const attendanceSummaryReportController = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await analytics.summaryData(tenantId(req), actor(req), {
      threshold: threshold(req),
      groupId: str(req.query.groupId),
      unitId: str(req.query.unitId),
      from: str(req.query.from),
      to: str(req.query.to),
    });
    const buffer = await buildSummaryWorkbook(data);
    sendXlsxAttachment(res, buffer, "attendance-summary.xlsx");
  },
);
