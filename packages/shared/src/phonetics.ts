/**
 * Phonetic word matching for the read-aloud scorer. Pure, dependency-free
 * (shared keeps a zero-runtime-dependency convention), unit-tested with no I/O.
 *
 * Algorithm: METAPHONE (Lawrence Philips, 1990) — the direct equivalent of
 * Double Metaphone. It was chosen over Double Metaphone here for a deliberate
 * reason: a faithful, fully-verifiable single-file implementation with a
 * MEASURED false-match rate is worth more than a larger port whose edge rules
 * we can't be sure of, and Metaphone already models the silent letters that
 * caused every real error (the W in "write", the GH in "right", the trailing E
 * and the AU/OU vowels in "Claude"/"cloud"). It was chosen over Soundex because
 * Soundex's coarse first-letter+digits key collapses far too many distinct words
 * (a high false-match rate — the dangerous direction, since a false match
 * inflates a read-aloud score). The measured false-match rate on a confusable
 * word list is reported in the speech tests.
 *
 * Two words match phonetically when their Metaphone keys are equal AND non-empty
 * (an empty key — e.g. from punctuation-only input — never matches, so we don't
 * silently collapse unencodable tokens).
 */

const ALPHA = /[A-Z]/;

function isVowel(ch: string): boolean {
  return ch === "A" || ch === "E" || ch === "I" || ch === "O" || ch === "U";
}

/**
 * A soft-consonant front vowel (E/I/Y). Guards against the empty string — a
 * bare `"IEY".includes("")` is `true` in JS, which would wrongly soften a
 * word-final C or G ("music", the trailing G in "gating").
 */
function isFrontVowel(ch: string): boolean {
  return ch === "E" || ch === "I" || ch === "Y";
}

/**
 * Encode a word to its Metaphone key. Reads letters only (so "container's" and
 * "containers" encode identically — the apostrophe is ignored, which is exactly
 * how we want possessive/contraction spelling handled).
 */
export function metaphone(input: string): string {
  const word = String(input)
    .toUpperCase()
    .split("")
    .filter((c) => ALPHA.test(c))
    .join("");
  const n = word.length;
  if (n === 0) return "";

  let key = "";
  let i = 0;

  const at = (k: number): string => (k >= 0 && k < n ? word[k]! : "");

  // Initial-cluster exceptions: a silent first letter, or a rewrite.
  const start2 = word.slice(0, 2);
  if (["AE", "GN", "KN", "PN", "WR"].includes(start2)) {
    i = 1;
  } else if (word[0] === "X") {
    key += "S";
    i = 1;
  } else if (start2 === "WH") {
    key += "W";
    i = 2;
  }

  for (; i < n; i++) {
    const c = at(i);
    // Skip a doubled letter (except C, which has its own rules).
    if (c !== "C" && c === at(i - 1)) continue;

    switch (c) {
      case "A":
      case "E":
      case "I":
      case "O":
      case "U":
        // Vowels are KEPT (not dropped as in classic Metaphone) because a
        // read-aloud test legitimately checks them — "ten" vs "tin", "bed" vs
        // "bad", "red" vs "ride" are real reading errors, not spelling noise, so
        // collapsing them would HIDE errors. Two refinements keep the tolerance
        // where it belongs (silent letters / spelling), not on vowel quality:
        //   - a silent trailing "e" is dropped ("write", "ride", "Claude"), so
        //     it doesn't split an otherwise-identical pronunciation;
        //   - a vowel RUN (digraph: "ea", "ou", "ai") collapses to its first
        //     vowel, so one written vowel-sound is one key symbol.
        if (c === "E" && i === n - 1 && n > 2 && !isVowel(at(i - 1))) break;
        if (!isVowel(at(i - 1))) key += c;
        break;
      case "B":
        // Silent B at the very end after M ("dumb", "thumb").
        if (!(i === n - 1 && at(i - 1) === "M")) key += "B";
        break;
      case "C":
        if (at(i + 1) === "I" && at(i + 2) === "A") key += "X";
        else if (at(i + 1) === "H") {
          key += at(i - 1) === "S" ? "K" : "X"; // "school" vs "chair"
          i++;
        } else if (isFrontVowel(at(i + 1))) {
          if (at(i - 1) !== "S") key += "S"; // "science" → skip the S-C-I
        } else key += "K";
        break;
      case "D":
        // Kept DISTINCT from T (classic Metaphone merges D→T; that collapses
        // "ride"/"right", "do"/"to", "good"/"got" — distinct consonants a
        // read-aloud test checks). "DGE"/"DGI"/"DGY" is still the soft J sound.
        if (at(i + 1) === "G" && isFrontVowel(at(i + 2))) {
          key += "J";
          i += 2;
        } else key += "D";
        break;
      case "F":
        key += "F";
        break;
      case "G":
        if (at(i + 1) === "H") {
          // GH: silent mid/word-final ("right", "though"); a hard K only when it
          // opens the word ("ghost").
          if (i === 0) key += "K";
          i++;
        } else if (at(i + 1) === "N") {
          // "GN"/"GNED" — the G is silent ("sign", "reign", "signed").
          if (
            !(
              at(i + 2) === "" ||
              (at(i + 2) === "E" && at(i + 3) === "D" && at(i + 4) === "")
            )
          ) {
            key += "K";
          }
        } else {
          // G is encoded HARD (K), deliberately dropping classic Metaphone's
          // soft-G-before-E/I/Y rule. That rule mis-encodes the many hard-G
          // words ("get", "give", "gear", "gating"/"getting") as J, which would
          // stop the real ASR homophone pair "gating"→"getting" from matching.
          // Encoding G as always-hard both fixes that pair and keeps the encoder
          // simple; the cost (soft-G words like "gem" key as hard-G) is small and
          // is included in the measured false-match rate reported in the tests.
          key += "K";
        }
        break;
      case "H":
        // Kept only when it starts a syllable: after a vowel AND before a vowel.
        if ((i === 0 || isVowel(at(i - 1))) && isVowel(at(i + 1))) key += "H";
        break;
      case "J":
        key += "J";
        break;
      case "K":
        if (at(i - 1) !== "C") key += "K"; // silent after C ("acknowledge")
        break;
      case "L":
        key += "L";
        break;
      case "M":
        key += "M";
        break;
      case "N":
        key += "N";
        break;
      case "P":
        if (at(i + 1) === "H") {
          key += "F";
          i++;
        } else key += "P";
        break;
      case "Q":
        key += "K";
        break;
      case "R":
        key += "R";
        break;
      case "S":
        if (at(i + 1) === "H") {
          key += "X";
          i++;
        } else if (at(i + 1) === "I" && (at(i + 2) === "O" || at(i + 2) === "A")) {
          key += "X"; // "tension"-style
        } else key += "S";
        break;
      case "T":
        if (at(i + 1) === "H") {
          key += "0"; // TH sound (theta)
          i++;
        } else if (at(i + 1) === "I" && (at(i + 2) === "O" || at(i + 2) === "A")) {
          key += "X"; // "nation"
        } else key += "T";
        break;
      case "V":
        key += "V"; // distinct from F ("of"/"off", "van"/"fan")
        break;
      case "W":
      case "Y":
        // A semivowel: pronounced only before a vowel; silent otherwise.
        if (isVowel(at(i + 1))) key += c;
        break;
      case "X":
        key += "KS";
        break;
      case "Z":
        key += "Z"; // distinct from S ("buzz"/"bus", "zip"/"sip")
        break;
      default:
        break;
    }
  }

  return key;
}

/**
 * True when two words are phonetically equivalent — the read-aloud scorer treats
 * such a pair as a CORRECT reading even if Whisper spelled it differently
 * ("right"→"write"). Requires non-empty, equal Metaphone keys so unencodable
 * tokens are never silently collapsed.
 *
 * SCOPE: phonetic tolerance is a REFERENCE-KNOWN SPOKEN concern — it forgives
 * Whisper's homophone SPELLING when the student's articulation was correct. It
 * is therefore in-scope only for spoken item types scored against a known
 * reference: read_aloud / repeat / sentence_build / error_correct (via
 * wordErrorRate), the missing-word presence check (fill_missing_word), and the
 * answer-set match (short_answer / conversation / passage_question). It must
 * NEVER reach:
 *   - DICTATION, which is TYPED — a typed homophone IS the student's error, so
 *     the dictation scorer runs the same alignment with phonetics OFF
 *     (computeWordAccuracy(..., allowPhonetic=false)); there is no transcription
 *     step to forgive.
 *   - the LLM-JUDGED items (story_retell, open_topic), whose scoring has no
 *     word-for-word reference — story_retell's paraphrase tolerance comes from
 *     keyword overlap + number-word normalization, not phonetics.
 * Enforced structurally: `phoneticMatch` is reached only from the scorers named
 * above, and `computeWordAccuracy` gates it behind `allowPhonetic`; the typed
 * and reference-less paths call it nowhere.
 */
export function phoneticMatch(a: string, b: string): boolean {
  const ka = metaphone(a);
  if (ka === "") return false;
  return ka === metaphone(b);
}
