/**
 * LandingPage — CodeApt's public marketing front door, served at "/" for
 * logged-out visitors (authenticated visitors are redirected to /app by the
 * route). A cinematic, layered scroll: hero → feature showcase → real
 * code-execution highlight → honest capability band → who-it's-for/why-CodeApt
 * → final CTA → the shared site footer.
 *
 * Cohesion + a11y: built entirely on the app's design tokens and ui/ primitives
 * (so a visitor who signs up meets the same visual language), with a single <h1>
 * in the hero and one <h2> per <section aria-labelledby>. All non-essential
 * motion is gated behind prefers-reduced-motion via the shared motion helpers;
 * with motion off the page is calm, complete and fully functional.
 */
import { Footer } from "../../components/layout/Footer.js";
import { LandingHeader } from "./LandingHeader.js";
import { IntroVideoOverlay } from "./components/IntroVideoOverlay.js";
import { AudienceSection } from "./sections/AudienceSection.js";
import { ExecutionSection } from "./sections/ExecutionSection.js";
import { FeaturesSection } from "./sections/FeaturesSection.js";
import { FinalCtaSection } from "./sections/FinalCtaSection.js";
import { HeroSection } from "./sections/HeroSection.js";
import { StatsSection } from "./sections/StatsSection.js";

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <IntroVideoOverlay />
      <LandingHeader />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <ExecutionSection />
        <StatsSection />
        <AudienceSection />
        <FinalCtaSection />
      </main>
      <Footer />
    </div>
  );
}
