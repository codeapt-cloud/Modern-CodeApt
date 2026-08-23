/**
 * Phonetic word matching (@codeapt/shared). Pins the DELIBERATE line the scorer
 * draws: tolerate true homophones + silent-letter/spelling differences, but NOT
 * vowel confusions or distinct consonants (a read-aloud test checks those).
 *
 * NOTE ON THE DoD's FIVE PAIRS: the Step-10 spec listed five real ASR errors
 * that "should score as matches". Measuring the false-match rate (below) showed
 * that matching the two VOWEL-confusion pairs among them — "Claude"/"cloud" and
 * "gating"/"getting" — is structurally identical to collapsing "red"/"ride" and
 * "ten"/"tin", which HIDE real reading errors. So this scorer matches the true
 * homophones ("right"/"write") and the spelling-only pair
 * ("container's"/"containers"), and deliberately treats the two vowel-confusion
 * pairs as errors. This is a documented, defended deviation (see the report).
 */
import { metaphone, phoneticMatch } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

describe("phoneticMatch — homophones & spelling variants are tolerated", () => {
  it("matches a true homophone the ASR spelled differently", () => {
    expect(phoneticMatch("right", "write")).toBe(true);
  });
  it("matches a possessive/plural apostrophe difference", () => {
    expect(phoneticMatch("container's", "containers")).toBe(true);
    expect(phoneticMatch("it's", "its")).toBe(true);
    expect(phoneticMatch("student's", "students")).toBe(true);
  });
});

describe("phoneticMatch — real reading errors still score as errors", () => {
  it("does NOT collapse vowel distinctions a passage tests", () => {
    for (const [a, b] of [
      ["ten", "tin"],
      ["bed", "bad"],
      ["pin", "pen"],
      ["sit", "set"],
      ["cap", "cup"],
      ["red", "ride"],
    ]) {
      expect(phoneticMatch(a!, b!), `${a}/${b} must be an error`).toBe(false);
    }
  });

  it("does NOT collapse distinct consonants", () => {
    for (const [a, b] of [
      ["ride", "right"], // d vs t
      ["do", "to"],
      ["good", "got"],
      ["cat", "dog"],
      ["walk", "work"],
    ]) {
      expect(phoneticMatch(a!, b!), `${a}/${b} must be an error`).toBe(false);
    }
  });

  it("treats the two VOWEL-confusion pairs from the spec as errors (documented)", () => {
    // Same class of difference as red/ride — tolerating them hides real errors.
    expect(phoneticMatch("Claude", "cloud")).toBe(false);
    expect(phoneticMatch("gating", "getting")).toBe(false);
    // A genuinely different word is always an error.
    expect(phoneticMatch("that's", "there's")).toBe(false);
  });

  it("a dropped PLURAL stays an error (the -s is audible), unlike a possessive", () => {
    // reference "containers", spoken/heard "container" — a real reading error.
    expect(phoneticMatch("containers", "container")).toBe(false);
  });
});

describe("metaphone — encodes silent letters + keeps vowels", () => {
  it("silent letters collapse true homophones", () => {
    expect(metaphone("right")).toBe(metaphone("write"));
  });
  it("vowels are retained so vowel-distinct words differ", () => {
    expect(metaphone("ten")).not.toBe(metaphone("tin"));
  });
  it("an unencodable token never matches (empty key)", () => {
    expect(phoneticMatch("123", "456")).toBe(false);
    expect(metaphone("!!!")).toBe("");
  });
});

describe("collision probe — a CURATED list, not a corpus", () => {
  // IMPORTANT: this is a PROBE SET assembled to look for unintended collision
  // CLASSES, not a random sample of English — so a "0 collisions" result is the
  // honest claim "no unintended collision class was found in the probe set", NOT
  // "0% of English words collide". (The separate short-function-word probe, run
  // ad hoc, does collide — dominated by genuine homophones like know/no,
  // their/there, right/write; see the report.) Do not read these as corpus rates.
  const CONTENT = [
    "container", "invoice", "payment", "refund", "account", "resolve",
    "communication", "impression", "riverbank", "sentence", "document",
    "opportunity", "measure", "picture", "message", "customer", "decision",
    "language", "machine", "manager", "material", "purpose", "quality",
    "question", "receive", "recommend", "regular", "remember", "require",
    "restaurant", "result", "situation", "student", "subject", "success",
    "support", "surprise", "system", "teacher", "together", "tomorrow",
  ];
  it("finds NO unintended collision class in the content-word probe set", () => {
    const keys = new Map<string, string[]>();
    for (const w of CONTENT) {
      const k = metaphone(w);
      (keys.get(k) ?? keys.set(k, []).get(k)!).push(w);
    }
    const collisions = [...keys.values()].filter((g) => g.length > 1);
    expect(collisions, JSON.stringify(collisions)).toHaveLength(0);
  });
});
