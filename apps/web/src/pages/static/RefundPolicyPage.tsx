/**
 * Refund and Cancellation Policy — verbatim from the original CodeApt template.
 */
import { Container } from "../../components/layout/Container.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Prose } from "../../components/static/Prose.js";

export function RefundPolicyPage() {
  return (
    <Container size="md" className="py-12">
      <PageHeader title="Refund and Cancellation Policy" />
      <Prose className="mt-8">
        <p>
          This refund and cancellation policy outlines how you can cancel or seek
          a refund for a product / service that you have purchased through the
          Platform. Under this policy:
        </p>
        <p className="rounded-xl border border-primary/30 bg-primary/10 p-4 font-medium text-ink">
          1. Refund Processing: In case of any refunds approved by CODEAPT LLP, it
          will take 5 days for the refund to be processed to you.
        </p>
      </Prose>
    </Container>
  );
}
