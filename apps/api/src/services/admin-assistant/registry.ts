/**
 * The tool registry (Step 40: read-only GUIDE). Every tool is a READ that wraps an
 * existing service, so the assistant can SITUATE its guidance in the admin's real
 * data ("you already have a SPEAKING topic under Data Structures…"). There are NO
 * write tools — the guide never mutates; a test asserts this.
 */
import {
  collegeStudentListQuerySchema,
  type Role,
} from "@codeapt/shared";
import { z } from "zod";

import { AppError } from "../../errors/app-error.js";
import { getCollege, listColleges } from "../college.service.js";
import { getCollegeSummary } from "../college-summary.service.js";
import { listCollegeExams } from "../college-exam.service.js";
import { listCollegeGameSets } from "../college-game.service.js";
import { listExamTopics } from "../curriculum-admin.service.js";
import { listOrgUnitTree } from "../org-unit.service.js";
import { listCollegeStudents } from "../student.service.js";
import { listCollegeSpeaking } from "../speaking.service.js";
import { listCollegeCommunication } from "../communication.service.js";
import { listCollegeInterviews } from "../mock-interview.service.js";
import { capabilityTool } from "./capabilities.js";
import type { Access, RegisteredTool, ResolvedCtx } from "./types.js";

function readTool<S extends z.ZodTypeAny>(def: {
  name: string;
  access: Access;
  needsCollege: boolean;
  description: string;
  argHint: string;
  schema: S;
  run: (ctx: ResolvedCtx, args: z.infer<S>) => Promise<unknown>;
}): RegisteredTool {
  return {
    name: def.name,
    kind: "read",
    access: def.access,
    needsCollege: def.needsCollege,
    description: def.description,
    argHint: def.argHint,
    parse: (raw) => def.schema.parse(raw),
    run: (ctx, args) => def.run(ctx, args as z.infer<S>),
  };
}

/** The resolved target college is guaranteed present for needsCollege tools. */
function reqCollege(ctx: ResolvedCtx): string {
  if (!ctx.collegeId) {
    throw new AppError("This lookup needs a target college.", 400, "INVALID_ARGS");
  }
  return ctx.collegeId;
}
function actorOf(ctx: ResolvedCtx): { userId: string; role: Role } {
  return { userId: ctx.userId, role: ctx.role };
}

const empty = z.object({}).strip();

const reads: RegisteredTool[] = [
  // The knowledge base that grounds the guidance (no DB; see capabilities.ts).
  capabilityTool,

  readTool({
    name: "list_colleges",
    access: "super",
    needsCollege: false,
    description: "List every college on the platform (id, name, slug, status).",
    argHint: "{} (no arguments)",
    schema: empty,
    run: async () =>
      (await listColleges()).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        status: c.status,
      })),
  }),
  readTool({
    name: "list_org_units",
    access: "both",
    needsCollege: true,
    description:
      "List the college's org units (departments/sections) with their ids — to situate answers that involve cohorts/targeting.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: (ctx) => listOrgUnitTree(reqCollege(ctx)),
  }),
  readTool({
    name: "list_course_topics",
    access: "super",
    needsCollege: false,
    description: "List course-curriculum EXAM topics with their ids.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: () => listExamTopics(),
  }),
  readTool({
    name: "list_students",
    access: "both",
    needsCollege: true,
    description:
      "List students in the college (optionally filtered to one org unit).",
    argHint: "{ orgUnitId?: string }",
    schema: collegeStudentListQuerySchema,
    run: (ctx, args) => listCollegeStudents(reqCollege(ctx), actorOf(ctx), args),
  }),
  readTool({
    name: "list_exams",
    access: "both",
    needsCollege: true,
    description: "List the college's exams (authoring view) with publish state.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: (ctx) => listCollegeExams(reqCollege(ctx), actorOf(ctx)),
  }),
  readTool({
    name: "list_game_sets",
    access: "both",
    needsCollege: true,
    description: "List the college's game sets with publish state.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: (ctx) => listCollegeGameSets(reqCollege(ctx), actorOf(ctx)),
  }),
  readTool({
    name: "list_speaking",
    access: "both",
    needsCollege: true,
    description: "List the college's speaking assessments with publish state.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: (ctx) => listCollegeSpeaking(reqCollege(ctx)),
  }),
  readTool({
    name: "list_composites",
    access: "both",
    needsCollege: true,
    description:
      "List the college's communication (composite) assessments with publish state.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: (ctx) => listCollegeCommunication(reqCollege(ctx)),
  }),
  readTool({
    name: "list_interviews",
    access: "both",
    needsCollege: true,
    description: "List the college's mock interviews with publish state.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: (ctx) => listCollegeInterviews(reqCollege(ctx)),
  }),
  readTool({
    name: "cohort_summary",
    access: "both",
    needsCollege: true,
    description:
      "Cohort + activity summary for the college (student counts, rollups).",
    argHint: "{} (no arguments)",
    schema: empty,
    run: async (ctx) => {
      const id = reqCollege(ctx);
      const college = await getCollege(id);
      return getCollegeSummary(id, actorOf(ctx), college.entitlements.grantedCourses);
    },
  }),
  readTool({
    name: "entitlements",
    access: "both",
    needsCollege: true,
    description:
      "The college's enabled features, sub-capabilities, granted courses and AI credits.",
    argHint: "{} (no arguments)",
    schema: empty,
    run: async (ctx) => {
      const college = await getCollege(reqCollege(ctx));
      return { entitlements: college.entitlements, credits: college.credits };
    },
  }),
];

export const ADMIN_ASSISTANT_TOOLS: RegisteredTool[] = reads;

const BY_NAME = new Map(ADMIN_ASSISTANT_TOOLS.map((t) => [t.name, t]));
export function getTool(name: string): RegisteredTool | undefined {
  return BY_NAME.get(name);
}
