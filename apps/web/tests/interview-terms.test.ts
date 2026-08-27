/**
 * Step 34 fix #3 — domain-term correction. Corrects STT mishearings of KNOWN
 * terms (edit distance + phonetics) without rewriting phrasing, keeps the
 * original, and reports what changed. The false-positive guard is the point:
 * a genuine "friend" must never become "frontend".
 */
import { correctTranscript } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const TERMS = ["frontend", "Kubernetes", "PostgreSQL", "Node.js", "REST", "OAuth"];
const correct = (raw: string) => correctTranscript(raw, TERMS);

describe("correctTranscript — real domain-term examples", () => {
  it("collapses multi-word mishearings to the canonical term", () => {
    expect(correct("I worked on the front end").corrected).toBe("I worked on the frontend");
    expect(correct("we used front and code").corrected).toBe("we used frontend code");
    expect(correct("built with node js").corrected).toBe("built with Node.js");
    expect(correct("we added o auth").corrected).toBe("we added OAuth");
  });

  it("fixes single-word near-misses (edit distance) of NON-common-word terms", () => {
    expect(correct("deployed on kubernetis").corrected).toBe("deployed on Kubernetes");
    expect(correct("stored in postgres").corrected).toBe("stored in PostgreSQL");
    expect(correct("oauth flow").corrected).toBe("OAuth flow");
  });

  it("reports exactly which spans were corrected, and how", () => {
    const r = correct("front and talks to kubernetis");
    expect(r.applied).toEqual([
      { from: "front and", to: "frontend", kind: "near" },
      { from: "kubernetis", to: "Kubernetes", kind: "near" },
    ]);
    expect(r.original).toBe("front and talks to kubernetis");
  });

  it("NEVER corrects a genuine word that isn't a domain term (false-positive guard)", () => {
    const r = correct("I called my friend for the rest of the day");
    // "friend" is too far from "frontend" (norm 0.5) → untouched.
    expect(r.corrected).toContain("friend");
    expect(r.applied.some((a) => a.to === "frontend")).toBe(false);
    // "node" alone is too far from "Node.js" (0.33) → untouched.
    expect(correct("that was a good node").applied).toHaveLength(0);
  });

  it("leaves COMMON WORDS alone even when they collide with a term in the list", () => {
    // The list contains frontend, REST, React AND Go — the risky collision case.
    const terms = ["frontend", "Kubernetes", "REST", "React", "Go", "Node.js"];
    const c = (raw: string) => correctTranscript(raw, terms);
    // Named cases from the review — the student's real word must survive.
    expect(c("my friend recommended this role").corrected).toBe(
      "my friend recommended this role",
    );
    expect(c("I need the rest of the day").corrected).toBe("I need the rest of the day");
    expect(c("she tends to react badly to change").corrected).toBe(
      "she tends to react badly to change",
    );
    expect(c("I want to go home early").corrected).toBe("I want to go home early");
    // Near-variants of a common-word term are also protected ("reacts" ≉ React here).
    expect(c("she reacts badly under pressure").applied).toHaveLength(0);
    // …but a genuine domain mishearing of a NON-common term still corrects, and a
    // multi-word collapse to a non-common term still works.
    expect(c("deployed on kubernetis").corrected).toBe("deployed on Kubernetes");
    expect(c("the front end code").corrected).toBe("the frontend code");
  });

  it("does not touch phrasing or content — only term spans change", () => {
    const raw = "honestly I think the front end was the hardest part of the project";
    const r = correct(raw);
    expect(r.corrected).toBe(
      "honestly I think the frontend was the hardest part of the project",
    );
    // Same word count minus the one collapsed 2-gram; nothing else moved.
    expect(r.corrected.split(" ").length).toBe(raw.split(" ").length - 1);
  });

  it("returns the input unchanged when there are no terms", () => {
    const r = correctTranscript("front end stuff", []);
    expect(r.corrected).toBe("front end stuff");
    expect(r.applied).toHaveLength(0);
  });

  it("leaves an already-correct term alone (no redundant correction recorded)", () => {
    const r = correct("I built the frontend with Node.js");
    expect(r.corrected).toBe("I built the frontend with Node.js");
    expect(r.applied).toHaveLength(0);
  });
});
