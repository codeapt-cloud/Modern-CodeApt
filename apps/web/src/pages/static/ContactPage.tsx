/**
 * Contact Us — verbatim contact DETAILS from the original CodeApt template.
 *
 * The original had a Django POST contact form. The rebuild has no contact-form
 * backend, so we deliberately render the details (not a fake, non-functional
 * form). Email is a mailto: link; the Telegram channel opens in a new tab.
 *
 * TODO: contact form backend (not in original scope of this step).
 */
import { Mail, MapPin, Send } from "lucide-react";

import { Container } from "../../components/layout/Container.js";
import { PageHeader } from "../../components/layout/PageHeader.js";

export function ContactPage() {
  return (
    <Container size="md" className="py-12">
      <PageHeader
        title="Get in Touch"
        description="Interested in our Campus Recruitment Training or Technical programs? Reach out to us."
      />

      <div className="mt-8 space-y-4">
        <div className="flex items-start gap-4 rounded-2xl border border-subtle bg-surface-base p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <MapPin className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Office Address</h2>
            <p className="mt-1 text-ink-secondary">
              CodeApt LLP, Nagole, Hyderabad, Telangana.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-2xl border border-subtle bg-surface-base p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Mail className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Email</h2>
            <a
              href="mailto:director@codeapt.in"
              className="mt-1 inline-block text-primary hover:underline"
            >
              director@codeapt.in
            </a>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-2xl border border-subtle bg-surface-base p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Send className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Reach Us</h2>
            <a
              href="https://t.me/aptitudehemanth/64015"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-primary hover:underline"
            >
              Telegram Channel
            </a>
          </div>
        </div>
      </div>
    </Container>
  );
}
