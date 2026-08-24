/**
 * Communication module hub (Phase 3, non-speech). The module is delivered ON
 * TOP of the existing exam + essay engines — grammar & comprehension are Exams,
 * scenario email is an EssayTopic with promptKind=email — so this hub does not
 * introduce a new resource; it orients the user and links into those surfaces
 * (which carry their own tenant/course access + authoring). Role-aware: an
 * operator sees "author"; a student sees "your assigned" copy. The speech half
 * (Sections A & B) is LIVE — all eleven speaking item types ship — and links
 * into the Speaking page.
 */
import { CollegeFeature, Role, checkEntitlement } from "@codeapt/shared";
import { FileText, Headphones, Layers, Mail, Mic } from "lucide-react";
import { Link } from "react-router-dom";

import { Alert } from "../../components/ui/alert.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { useCollege } from "./college-context.js";

interface HubCard {
  icon: typeof Mail;
  title: string;
  operator: string;
  student: string;
  to: string | null;
}

export function CollegeCommunicationPage() {
  const { context } = useCollege();
  const entitled = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
  );
  const isStudent = context.membership.role === Role.STUDENT;

  const cards: HubCard[] = [
    {
      icon: FileText,
      title: "Grammar (Section C)",
      operator:
        "Author a 34-question grammar paper across the five categories — it's a standard exam, so it lives in your exam list.",
      student: "Open your exam list to take the assigned grammar paper.",
      to: "../exams",
    },
    {
      icon: Headphones,
      title: "Comprehension (Section D)",
      operator:
        "Build a paper with an audio passage, then MCQs about it — also a standard exam in your exam list.",
      student: "Open your exam list to take the assigned comprehension paper.",
      to: "../exams",
    },
    {
      icon: Mail,
      title: "Email writing (Round 2)",
      operator: "Author a scenario email prompt (promptKind = email).",
      student: "Write the scenario email and get a rubric-scored result.",
      to: "../essays",
    },
    {
      icon: Mic,
      title: "Speaking (Sections A & B)",
      operator:
        "Author speaking assessments across all eleven item types: read-aloud, repeat, short answer, sentence build, conversation, passage question, fill-missing-word, error-correct, dictation, story retell, and open topic (incl. role-play). Scored on word accuracy, listening & fluency, with grammar & relevance approximate; accent and clarity are not scored.",
      student:
        "Listening & speaking practice across eleven item types. You get word-accuracy, listening and fluency feedback — grammar and relevance are approximate, and accent and clarity are not scored.",
      to: "../speaking",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Communication</h1>
        <p className="text-sm text-ink-muted">
          {isStudent
            ? "Grammar & comprehension papers and scenario email writing assigned to you."
            : "Author the CTS-style communication assessment for your cohorts."}
        </p>
      </div>

      {!entitled ? (
        <Alert variant="info">
          Your college hasn’t enabled Communication yet.
        </Alert>
      ) : (
        <>
        {/* The composite — the whole paper as ONE assignable assessment. */}
        <Link to="assessments" className="block">
          <Card className="border-primary/40 transition-colors hover:border-primary">
            <CardContent className="flex items-start gap-3 p-5">
              <Layers className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <div className="font-medium text-ink">
                  Full Communication Assessment
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {isStudent
                    ? "Take the whole paper — grammar, comprehension, speaking, and email — in order, in one place."
                    : "Compose grammar, comprehension, speaking, and email into ONE ordered, weighted assessment with a single cohort report."}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => {
            const body = (
              <CardContent className="flex items-start gap-3 p-5">
                <c.icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />
                <div>
                  <div className="flex items-center gap-2 font-medium text-ink">
                    {c.title}
                    {c.to === null && (
                      <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-normal text-ink-muted">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {isStudent ? c.student : c.operator}
                  </p>
                </div>
              </CardContent>
            );
            return c.to ? (
              <Link key={c.title} to={c.to} className="block">
                <Card className="h-full transition-colors hover:border-ink-muted">
                  {body}
                </Card>
              </Link>
            ) : (
              <Card key={c.title} className="h-full opacity-70">
                {body}
              </Card>
            );
          })}
        </div>

        {/* C7 honesty: grammar & comprehension are ordinary Exams with no
            "communication section" marker, so these cards open the FULL exam
            list, not a specific paper. The composite above is the targeted,
            ordered path. */}
        <p className="text-xs text-ink-muted">
          Grammar and comprehension are standard exams and aren’t tagged as a
          distinct type, so those links open your full exam list. For the exact
          papers in the right order, use the Full Communication Assessment above.
        </p>
        </>
      )}
    </div>
  );
}

export default CollegeCommunicationPage;
