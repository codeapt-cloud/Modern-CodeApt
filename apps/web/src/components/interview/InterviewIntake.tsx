/**
 * Intake step (Step 34 A1): the student pastes a resume + job description and
 * (optionally) overrides the target role. TEXT ONLY — no file upload (the repo has
 * no PDF extraction and the resume is personal data we keep minimal; see Part 1).
 * The text drives LLM question generation server-side.
 */
import {
  INTERVIEW_JOB_DESCRIPTION_MAX_CHARS,
  INTERVIEW_RESUME_MAX_CHARS,
} from "@codeapt/shared";
import { useState } from "react";

import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";

export interface IntakeValues {
  resumeText: string;
  jobDescription: string;
  role: string;
}

export function InterviewIntake({
  defaultRole,
  onSubmit,
  starting,
}: {
  defaultRole: string;
  onSubmit: (v: IntakeValues) => void;
  starting: boolean;
}): JSX.Element {
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [role, setRole] = useState(defaultRole);
  // The server rejects an over-limit paste with an opaque 400; catch it here with a
  // live count + a clear message, and block the submit (Step 37.6).
  const resumeOver = resumeText.trim().length > INTERVIEW_RESUME_MAX_CHARS;
  const jdOver = jobDescription.trim().length > INTERVIEW_JOB_DESCRIPTION_MAX_CHARS;
  const ready =
    resumeText.trim().length > 0 && role.trim().length > 0 && !resumeOver && !jdOver;
  const counter = (len: number, max: number): JSX.Element => (
    <span className={`text-[11px] ${len > max ? "text-error-fg" : "text-ink-muted"}`}>
      {len.toLocaleString()} / {max.toLocaleString()} characters
    </span>
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-ink">Before we start</h2>
          <p className="text-sm text-ink-muted">
            Paste your resume and the job description so the interviewer can tailor
            its questions. Your resume is used only for this session and is never
            stored as a file.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="iv-role">Target role</Label>
          <Input
            id="iv-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Backend Engineer"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="iv-resume">Resume (paste text)</Label>
            {counter(resumeText.trim().length, INTERVIEW_RESUME_MAX_CHARS)}
          </div>
          <Textarea
            id="iv-resume"
            rows={7}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste the text of your resume…"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="iv-jd">Job description (optional)</Label>
            {counter(jobDescription.trim().length, INTERVIEW_JOB_DESCRIPTION_MAX_CHARS)}
          </div>
          <Textarea
            id="iv-jd"
            rows={5}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the job description…"
          />
        </div>
        {resumeOver || jdOver ? (
          <Alert variant="error">
            {resumeOver ? "Your resume" : "The job description"} is too long — please
            shorten it to under{" "}
            {(resumeOver
              ? INTERVIEW_RESUME_MAX_CHARS
              : INTERVIEW_JOB_DESCRIPTION_MAX_CHARS
            ).toLocaleString()}{" "}
            characters. Paste the relevant text, not an entire document.
          </Alert>
        ) : resumeText.trim().length === 0 || role.trim().length === 0 ? (
          <Alert variant="info">A resume and a target role are required to begin.</Alert>
        ) : null}
        <Button
          disabled={!ready || starting}
          onClick={() => onSubmit({ resumeText, jobDescription, role })}
        >
          {starting ? "Preparing your interview…" : "Start interview"}
        </Button>
      </CardContent>
    </Card>
  );
}
