/**
 * Intake step (Step 34 A1): the student pastes a resume + job description and
 * (optionally) overrides the target role. TEXT ONLY — no file upload (the repo has
 * no PDF extraction and the resume is personal data we keep minimal; see Part 1).
 * The text drives LLM question generation server-side.
 */
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
  const ready = resumeText.trim().length > 0 && role.trim().length > 0;

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
          <Label htmlFor="iv-resume">Resume (paste text)</Label>
          <Textarea
            id="iv-resume"
            rows={7}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste the text of your resume…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="iv-jd">Job description (optional)</Label>
          <Textarea
            id="iv-jd"
            rows={5}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the job description…"
          />
        </div>
        {!ready ? (
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
