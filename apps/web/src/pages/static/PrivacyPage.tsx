/**
 * Privacy Policy — content shipped verbatim from the original CodeApt template.
 */
import { Container } from "../../components/layout/Container.js";
import { PageHeader } from "../../components/layout/PageHeader.js";
import { Prose, ProseSection } from "../../components/static/Prose.js";

export function PrivacyPage() {
  return (
    <Container size="md" className="py-12">
      <PageHeader title="Privacy Policy" />
      <Prose className="mt-8">
        <ProseSection title="Introduction">
          <p>
            This Privacy Policy describes how CODEAPT LLP and its affiliates
            (collectively &quot;CODEAPT LLP, we, our, us&quot;) collect, use,
            share, protect or otherwise process your information/ personal data
            through our website https://www.codeapt.in/ (hereinafter referred to
            as Platform). We do not offer any product/service under this Platform
            outside India and your personal data will primarily be stored and
            processed in India.
          </p>
          <p>
            By visiting this Platform, providing your information or availing any
            product/service offered on the Platform, you expressly agree to be
            bound by the terms and conditions of this Privacy Policy.
          </p>
        </ProseSection>

        <ProseSection title="Collection of Information">
          <p>
            We collect your personal data when you use our Platform, services or
            otherwise interact with us. Some of the information that we may
            collect includes but is not limited to name, date of birth, address,
            telephone/mobile number, email ID, and/or any such information shared
            as proof of identity or address.
          </p>
          <p>
            We may also track your behaviour, preferences, and other information
            that you choose to provide on our Platform. This information is
            compiled and analysed on an aggregated basis.
          </p>
        </ProseSection>

        <ProseSection title="Usage of Information">
          <p>
            We use personal data to provide the services you request. We use your
            personal data to assist sellers and business partners in handling and
            fulfilling orders; enhancing customer experience; resolve disputes;
            troubleshoot problems; inform you about online and offline offers,
            products, services, and updates; customise your experience; detect and
            protect us against error, fraud and other criminal activity.
          </p>
        </ProseSection>

        <ProseSection title="Sharing of Information">
          <p>
            We may share your personal data internally within our group entities,
            our other corporate entities, and affiliates. We may disclose personal
            data to third parties such as sellers, business partners, third party
            service providers including logistics partners, prepaid payment
            instrument issuers, third-party reward programs and other payment
            opted by you.
          </p>
          <p>
            We may disclose personal and sensitive personal data to government
            agencies or other authorised law enforcement agencies if required to
            do so by law or in the good faith belief that such disclosure is
            reasonably necessary to respond to subpoenas, court orders, or other
            legal process.
          </p>
        </ProseSection>

        <ProseSection title="Security Precautions">
          <p>
            To protect your personal data from unauthorised access or disclosure,
            loss or misuse we adopt reasonable security practices and procedures.
            Once your information is in our possession or whenever you access your
            account information, we adhere to our security guidelines to protect it
            against unauthorised access and offer the use of a secure server.
          </p>
        </ProseSection>

        <ProseSection title="Data Deletion and Retention">
          <p>
            You have an option to delete your account by visiting your profile and
            settings on our Platform; this action would result in you losing all
            information related to your account. We retain your personal data
            information for a period no longer than is required for the purpose for
            which it was collected or as required under any applicable law.
          </p>
        </ProseSection>

        <ProseSection title="Contact Information">
          <p className="font-medium text-ink">Grievance Officer</p>
          <p>Please contact us for any privacy concerns.</p>
          <p>Phone: Monday - Friday (9:00 - 18:00)</p>
        </ProseSection>
      </Prose>
    </Container>
  );
}
