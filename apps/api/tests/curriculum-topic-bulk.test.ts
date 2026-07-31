/**
 * Bulk topic import (4c-i) — text/video only, per-subject, partial success.
 * Builds .xlsx workbooks in-memory with ExcelJS, base64-encodes them, and hits
 * POST /admin/subjects/:subjectId/topics/bulk-upload. Covers: a clean import
 * (modules get-or-created + text/video topics), a mixed workbook (bad type,
 * missing module, quiz/exam/essay rejected) that still imports the valid rows,
 * video auto-detect from a URL, and explicit-order honouring.
 */
import ExcelJS from "exceljs";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ModuleModel, TopicModel } from "../src/models/curriculum.model.js";
import request from "supertest";

let app: Express;
beforeAll(() => {
  app = createApp();
});

let counter = 0;
async function adminToken(): Promise<string> {
  counter += 1;
  const u = `cbulk${counter}`;
  await request(app)
    .post("/api/auth/register")
    .send({
      username: u,
      email: `${u}@example.com`,
      password: "Password123",
      fullName: `Bulk ${counter}`,
      rollNumber: `BROLL-${counter}`,
      collegeName: "Acme",
      phoneNumber: "9999999999",
      state: "KA",
    });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  const userId = res.body.user.id as string;
  const { UserModel } = await import("../src/models/user.model.js");
  await UserModel.updateOne({ _id: userId }, { $set: { role: "admin" } });
  const relog = await request(app)
    .post("/api/auth/login")
    .send({ identifier: u, password: "Password123" });
  return relog.body.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeSubject(token: string): Promise<string> {
  counter += 1;
  const res = await request(app)
    .post("/api/admin/subjects")
    .set(auth(token))
    .send({ name: `Bulk Subject ${counter}` });
  return res.body.id as string;
}

type Row = Record<string, string | number>;
async function workbookBase64(headers: string[], rows: Row[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Topics");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? ""));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

const upload = (token: string, subjectId: string, fileBase64: string) =>
  request(app)
    .post(`/api/admin/subjects/${subjectId}/topics/bulk-upload`)
    .set(auth(token))
    .send({ fileBase64 });

describe("curriculum admin — bulk topic upload", () => {
  it("imports text/video topics, get-or-creating modules", async () => {
    const token = await adminToken();
    const subjectId = await makeSubject(token);
    const headers = [
      "module",
      "name",
      "type",
      "content",
      "video_id",
      "duration",
      "order",
    ];
    const b64 = await workbookBase64(headers, [
      { module: "Basics", name: "Intro", type: "text", content: "# Hi" },
      { module: "Basics", name: "Setup", type: "text", content: "install" },
      {
        module: "Videos",
        name: "Lecture",
        type: "video",
        video_id: "dQw4w9WgXcQ",
        duration: "8 min",
      },
    ]);
    const res = await upload(token, subjectId, b64);
    expect(res.status).toBe(200);
    expect(res.body.createdModules).toBe(2);
    expect(res.body.createdTopics).toBe(3);
    expect(res.body.errors).toEqual([]);

    // Modules really exist under the subject.
    const modules = await ModuleModel.find({ subject: subjectId });
    expect(modules.length).toBe(2);
    const video = await TopicModel.findOne({ topicType: "video" });
    expect(video?.videoId).toBe("dQw4w9WgXcQ");
  });

  it("reports per-row errors but still imports the valid rows (partial success)", async () => {
    const token = await adminToken();
    const subjectId = await makeSubject(token);
    const headers = ["module", "name", "type", "content", "video_url"];
    const b64 = await workbookBase64(headers, [
      { module: "M1", name: "Good text", type: "text", content: "ok" }, // row 2 ✓
      { module: "M1", name: "Quiz row", type: "quiz" }, // row 3 ✗ rejected
      { module: "", name: "No module", type: "text" }, // row 4 ✗ missing module
      { module: "M1", name: "Bad type", type: "podcast" }, // row 5 ✗ invalid type
      { module: "M1", name: "Missing name is blank", type: "text", content: "x" }, // row 6 ✓ (has name)
    ]);
    const res = await upload(token, subjectId, b64);
    expect(res.status).toBe(200);
    expect(res.body.createdModules).toBe(1); // M1 once
    expect(res.body.createdTopics).toBe(2); // the two valid text rows
    const rows = res.body.errors.map((e: { row: number }) => e.row).sort();
    expect(rows).toEqual([3, 4, 5]);
    const quizErr = res.body.errors.find((e: { row: number }) => e.row === 3);
    expect(quizErr.message).toMatch(/individually/i);
    const modErr = res.body.errors.find((e: { row: number }) => e.row === 4);
    expect(modErr.message).toMatch(/module/i);
  });

  it("auto-detects a video topic from a video_url and honours explicit order", async () => {
    const token = await adminToken();
    const subjectId = await makeSubject(token);
    const headers = ["module", "name", "type", "video_url", "order"];
    const b64 = await workbookBase64(headers, [
      // No type given → auto-detect video from the URL.
      {
        module: "Auto",
        name: "From URL",
        video_url: "https://youtu.be/abcdefghijk",
        order: 5,
      },
      // No type, no video → text.
      { module: "Auto", name: "Plain", order: 2 },
    ]);
    const res = await upload(token, subjectId, b64);
    expect(res.status).toBe(200);
    expect(res.body.createdTopics).toBe(2);
    expect(res.body.errors).toEqual([]);

    const fromUrl = await TopicModel.findOne({ name: "From URL" });
    expect(fromUrl?.topicType).toBe("video");
    expect(fromUrl?.videoId).toBe("abcdefghijk");
    expect(fromUrl?.order).toBe(5); // explicit order honoured
    const plain = await TopicModel.findOne({ name: "Plain" });
    expect(plain?.topicType).toBe("text");
    expect(plain?.order).toBe(2);
  });

  it("rejects a non-admin (403)", async () => {
    const token = await adminToken();
    const subjectId = await makeSubject(token);
    // A fresh non-admin user.
    counter += 1;
    const u = `cbulku${counter}`;
    await request(app)
      .post("/api/auth/register")
      .send({
        username: u,
        email: `${u}@example.com`,
        password: "Password123",
        fullName: "Plain",
        rollNumber: `UBROLL-${counter}`,
        collegeName: "Acme",
        phoneNumber: "9999999999",
        state: "KA",
      });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: u, password: "Password123" });
    const b64 = await workbookBase64(["module", "name", "type"], [
      { module: "X", name: "Y", type: "text" },
    ]);
    const res = await request(app)
      .post(`/api/admin/subjects/${subjectId}/topics/bulk-upload`)
      .set(auth(login.body.accessToken as string))
      .send({ fileBase64: b64 });
    expect(res.status).toBe(403);
  });
});
