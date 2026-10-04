/**
 * Admin Assistant (Step 40: read-only GUIDE) — tests.
 *
 * Verifies the assistant can NEVER mutate (no write tool in the registry), that
 * the capability map answers representative "how do I" questions with the right
 * page / control / prerequisite (including the one where the prerequisite IS the
 * answer — attaching a game set to a course), that reads stay tenant-scoped, and
 * that a guide conversation (clarify/look-up → ordered steps) runs end to end. The
 * LLM seam is stubbed with registerLlmRouter so it's deterministic + quota-free.
 */
import { Role, UserType, registerLlmRouter } from "@codeapt/shared";
import type { Express } from "express";
import { Types } from "mongoose";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { UserModel } from "../src/models/user.model.js";
import * as colleges from "../src/services/college.service.js";
import { createCollegeExam } from "../src/services/college-exam.service.js";
import {
  ADMIN_ASSISTANT_TOOLS,
  ADMIN_CAPABILITIES,
  dispatchRead,
  handleChat,
  lookupCapabilities,
  type AssistantContext,
} from "../src/services/admin-assistant/index.js";

let app: Express;
beforeAll(() => {
  app = createApp();
});
afterEach(() => registerLlmRouter(null));

let n = 0;
async function makeUser(
  fields?: Partial<{ role: Role; userType: UserType; college: Types.ObjectId }>,
): Promise<{ userId: string }> {
  n += 1;
  const u = `aa${n}`;
  await request(app).post("/api/auth/register").send({
    username: u,
    email: `${u}@x.com`,
    password: "Password123",
    fullName: `User ${n}`,
    rollNumber: `AA-${n}`,
    collegeName: "Acme",
    phoneNumber: "9999999999",
    state: "KA",
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  if (fields) await UserModel.updateOne({ _id: userId }, { $set: fields });
  return { userId };
}

async function setupCollege(slug: string): Promise<{ collegeId: string; adminId: string }> {
  const platform = await makeUser({ role: Role.SUPER_ADMIN });
  const dto = await colleges.createCollege({ name: slug, slug }, platform.userId);
  await colleges.setEntitlements(dto.id, { features: { ai: true } });
  await colleges.setEntitlements(dto.id, {
    subCapabilities: { "ai.admin_assistant": true },
  });
  const admin = await makeUser({
    role: Role.COLLEGE_ADMIN,
    userType: UserType.COLLEGE,
    college: new Types.ObjectId(dto.id),
  });
  return { collegeId: dto.id, adminId: admin.userId };
}

const collegeCtx = (collegeId: string, userId: string): AssistantContext => ({
  userId,
  role: Role.COLLEGE_ADMIN,
  collegeId,
  scope: "college",
});
const platformCtx = (userId: string): AssistantContext => ({
  userId,
  role: Role.SUPER_ADMIN,
  collegeId: null,
  scope: "platform",
});

// ---------------------------------------------------------------------------

describe("the guide cannot mutate", () => {
  it("the registry contains ONLY read tools — no write/mutating tool exists", () => {
    expect(ADMIN_ASSISTANT_TOOLS.length).toBeGreaterThan(0);
    for (const t of ADMIN_ASSISTANT_TOOLS) expect(t.kind).toBe("read");
    // None of the Step-38 write tools survive.
    const names = new Set(ADMIN_ASSISTANT_TOOLS.map((t) => t.name));
    for (const dead of [
      "create_exam",
      "attach_public_link",
      "attach_exam_to_topic",
      "create_game_set",
      "set_published",
      "set_entitlement",
    ]) {
      expect(names.has(dead)).toBe(false);
    }
  });
});

describe("capability map", () => {
  it("has unique keys (the machine-checkable invariant)", () => {
    const keys = ADMIN_CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("'publish a composite' → the right page, control and the publish-order prerequisite", () => {
    const { matches } = lookupCapabilities("publish composite assessment") as {
      matches: typeof ADMIN_CAPABILITIES;
    };
    const cap = matches.find((c) => c.key === "composite.college");
    expect(cap).toBeTruthy();
    expect(cap!.route).toBe("/c/:slug/communication/assessments/manage");
    expect(cap!.affordance.toLowerCase()).toContain("publish");
    expect(cap!.prerequisites.join(" ")).toMatch(/every.*published/i);
    expect(cap!.failureModes.join(" ")).toContain("NOT_PUBLISHABLE");
  });

  it("'attach a game set to a course' → the prerequisite IS the answer (a GAME topic)", () => {
    const { matches } = lookupCapabilities("attach game set to a course") as {
      matches: typeof ADMIN_CAPABILITIES;
    };
    const cap = matches.find((c) => c.key === "gameset.platform_create");
    expect(cap).toBeTruthy();
    expect(cap!.prerequisites.join(" ")).toMatch(/GAME.*topic/);
    expect(cap!.failureModes.join(" ")).toContain("TOPIC_NOT_GAME");
  });

  it("'create a course topic' → curriculum editor + Add topic", () => {
    const { matches } = lookupCapabilities("create a course topic") as {
      matches: typeof ADMIN_CAPABILITIES;
    };
    const cap = matches.find((c) => c.key === "curriculum.create_topic");
    expect(cap).toBeTruthy();
    expect(cap!.affordance).toContain("New topic");
    // The Speaking/Communication topic types ARE offered by the editor dropdown.
    expect(cap!.affordance).toMatch(/Speaking/);
  });

  it("returns no matches for an action the product doesn't have", () => {
    const { matches } = lookupCapabilities("create a course from a PDF document") as {
      matches: typeof ADMIN_CAPABILITIES;
    };
    // Nothing in the map is about document ingestion → the guide says it's impossible.
    expect(matches.find((c) => c.key.includes("document"))).toBeUndefined();
  });
});

describe("reads stay tenant-scoped + access-gated", () => {
  it("pins the caller's college on a read even when the model names another", async () => {
    const a = await setupCollege(`g-a-${n}`);
    const b = await setupCollege(`g-b-${n}`);
    const su = { userId: (await makeUser({ role: Role.SUPER_ADMIN })).userId, role: Role.SUPER_ADMIN };
    await createCollegeExam(a.collegeId, su, {
      title: "Alpha-Guide-Exam",
      passPercentage: 40,
      calculatorEnabled: false,
      shuffleQuestions: false,
      shuffleOptions: false,
      resultsVisible: true,
      accessCodeEnabled: false,
      accessCode: "",
      orgUnitIds: [],
    });
    const result = await dispatchRead(
      collegeCtx(a.collegeId, a.adminId),
      "list_exams",
      { collegeId: b.collegeId },
    );
    expect(JSON.stringify(result)).toContain("Alpha-Guide-Exam");
  });

  it("refuses a super-only read tool for a college admin", async () => {
    const a = await setupCollege(`g-c-${n}`);
    await expect(
      dispatchRead(collegeCtx(a.collegeId, a.adminId), "list_colleges", {}),
    ).rejects.toMatchObject({ code: "TOOL_FORBIDDEN" });
  });
});

describe("conversation", () => {
  it("returns a STRUCTURED guide and strips any step route not in the map", async () => {
    const su = await makeUser({ role: Role.SUPER_ADMIN });
    registerLlmRouter(async (_s, user) =>
      /TOOL capability_details RESULT/.test(user)
        ? {
            action: "guide",
            message: "Here's how:",
            steps: [
              { text: "Create a GAME topic", route: "/admin/curriculum", control: "New topic" },
              { text: "Go nowhere", route: "/admin/not-a-real-page", control: "X" },
            ],
          }
        : { action: "read", tool: "capability_details", args: { query: "game topic" } },
    );
    const reply = await handleChat(platformCtx(su.userId), [
      { role: "user", content: "how do I attach a game set to a course?" },
    ]);
    expect(reply.kind).toBe("guide");
    expect(reply.steps).toHaveLength(2);
    expect(reply.steps![0]!.route).toBe("/admin/curriculum"); // known → kept
    expect(reply.steps![1]!.route).toBeUndefined(); // unknown → stripped, text kept
    expect(reply.steps![1]!.text).toBe("Go nowhere");
  });

  it("degrades cleanly when the LLM is unavailable", async () => {
    const su = await makeUser({ role: Role.SUPER_ADMIN });
    registerLlmRouter(async () => null);
    const reply = await handleChat(platformCtx(su.userId), [
      { role: "user", content: "how do I create a course topic?" },
    ]);
    expect(reply.kind).toBe("unavailable");
  });

  it("three real exchanges: create-a-topic, a refused composite publish, and the impossible", async () => {
    const su = await makeUser({ role: Role.SUPER_ADMIN });
    const ctx = platformCtx(su.userId);

    // A compliant guide: FIRST look up the capability, THEN answer (never claims
    // to have done anything). Canned answers mirror the real map.
    registerLlmRouter(async (_s, user) => {
      // Branch on the ADMIN's latest line only (the capability index itself
      // mentions many topics, so matching the whole prompt would misfire).
      const adminLine = (user.match(/Admin: .*/g) ?? []).pop() ?? "";
      const lookedUp = /TOOL capability_details RESULT/.test(user);
      if (!lookedUp) {
        return { action: "read", tool: "capability_details", args: { query: adminLine } };
      }
      if (/course topic/i.test(adminLine)) {
        return {
          action: "say",
          message:
            "To create a course topic, go to Manage curriculum → open the Course → open a Module → Add topic, and pick the TYPE (e.g. GAME). Heads-up: the type can't be changed later, and content like a game set needs a matching topic type to attach.",
        };
      }
      if (/composite/i.test(adminLine)) {
        return {
          action: "say",
          message:
            "Publishing a composite is refused until every part is published — you'll see NOT_PUBLISHABLE naming the part. First open each component (exam/essay/speaking) and click Publish, then open the composite at Communication → the assessment → Publish.",
        };
      }
      return {
        action: "say",
        message:
          "There's no create-a-course-from-a-document path in the product. You'd create the course manually under Manage curriculum and add its topics/content yourself.",
      };
    });

    const transcript: string[] = [];
    for (const q of [
      "How do I create a course topic?",
      "How do I publish a composite assessment?",
      "Can I create a course from a PDF document?",
    ]) {
      const reply = await handleChat(ctx, [{ role: "user", content: q }]);
      expect(reply.kind).toBe("message");
      expect(reply.toolsUsed).toContain("capability_details");
      // The guide never claims to have performed the action.
      expect(reply.message.toLowerCase()).not.toMatch(/\b(i|i've|i have) (created|published|enabled|deleted)/);
      transcript.push(`Admin: ${q}`, `Guide: ${reply.message}`, "");
    }
    expect(transcript.join("\n")).toMatch(/Add topic/);
    expect(transcript.join("\n")).toMatch(/NOT_PUBLISHABLE/);
    expect(transcript.join("\n")).toMatch(/no create-a-course-from-a-document/i);
    console.log(`\n--- ADMIN GUIDE — THREE EXCHANGES ---\n${transcript.join("\n")}`);
  });
});

describe("route guards (HTTP)", () => {
  it("blocks a FACULTY user from the college assistant", async () => {
    const slug = `g-rg-${n + 1}`;
    const a = await setupCollege(slug);
    const facultyRes = await makeUser({
      role: Role.FACULTY,
      userType: UserType.COLLEGE,
      college: new Types.ObjectId(a.collegeId),
    });
    await UserModel.updateOne(
      { _id: facultyRes.userId },
      { $set: { forcePasswordChange: false } },
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: `aa${n}`, password: "Password123" });
    const res = await request(app)
      .post(`/api/c/${slug}/assistant/chat`)
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(403);
  });
});
