/**
 * The per-section entry points in the college exam editor: "AI Build" (draft
 * questions into THIS section with AI — see SectionAiBuildDialog), plus the bank
 * pulls "Standard Bank" / "Coding Bank" (gated by the `question_banks` grant —
 * disabled with a hint when the college isn't granted the global banks) and
 * "Self Bank" (always available — the college's own data). Each bank button
 * opens the shared BankPickerDialog to pull specific questions into THIS section.
 * Rendered via ExamSectionCard's `headerActions` slot, so the platform-admin
 * editor (which doesn't pass it) is unchanged. (Building a WHOLE exam — creating
 * sections + questions — is the exam-header "Full Exam AI Build".)
 */
import { Boxes, Code2, Library, Sparkles } from "lucide-react";
import { useState } from "react";

import type { BankSource } from "../../../lib/question-bank-ui.js";
import { Button } from "../../ui/button.js";
import { BankPickerDialog } from "./BankPickerDialog.js";
import { SectionAiBuildDialog } from "./SectionAiBuildDialog.js";

export function SectionBankButtons({
  slug,
  examId,
  sectionId,
  sectionName,
  granted,
  onAdded,
}: {
  slug: string;
  examId: string;
  sectionId: string;
  sectionName: string;
  /** Whether the college has the `question_banks` grant (global banks). */
  granted: boolean;
  onAdded: () => void;
}) {
  const [source, setSource] = useState<BankSource | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setAiOpen(true)}>
        <Sparkles className="h-4 w-4" /> AI Build
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!granted}
        title={granted ? undefined : "Ask your CodeApt admin to enable Question Banks"}
        onClick={() => setSource("standard")}
      >
        <Boxes className="h-4 w-4" /> Standard Bank
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!granted}
        title={granted ? undefined : "Ask your CodeApt admin to enable Question Banks"}
        onClick={() => setSource("coding")}
      >
        <Code2 className="h-4 w-4" /> Coding Bank
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setSource("self")}>
        <Library className="h-4 w-4" /> Self Bank
      </Button>

      {source ? (
        <BankPickerDialog
          open
          onOpenChange={(o) => {
            if (!o) setSource(null);
          }}
          slug={slug}
          source={source}
          examId={examId}
          sectionId={sectionId}
          sectionName={sectionName}
          onAdded={onAdded}
        />
      ) : null}

      <SectionAiBuildDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        slug={slug}
        examId={examId}
        sectionId={sectionId}
        sectionName={sectionName}
        onGenerated={onAdded}
      />
    </>
  );
}
