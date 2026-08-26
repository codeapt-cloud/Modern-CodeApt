/**
 * EVALUATION ONLY (CodeApt Step 31). Scores one engine's transcript against
 * another's using OUR OWN grader — `wordErrorRate` from @codeapt/shared, which is
 * exactly `computeWordAccuracy(ref, hyp, true)` (phonetic tolerance ON), the
 * read-aloud grading path (homophone tolerance via phonetics.ts). So the number below is
 * the WER in the SAME terms our scoring uses, and it prints the SPECIFIC differing
 * words — a forgiven homophone (phoneticMatches) is harmless; a missed/mis-said
 * content word is not.
 *
 *   node bench/asr-wer.mjs <REFERENCE.txt> <HYPOTHESIS.txt>
 *
 * Reference = the Whisper transcript (BASELINE, not verified ground truth).
 * Hypothesis = the Vosk transcript.
 */
import { readFile } from "node:fs/promises";

// The built shared scorer. Relative path (bench/ is outside the workspace
// node_modules graph); run `pnpm --filter @codeapt/shared build` first.
import { wordErrorRate } from "../packages/shared/dist/index.js";

const [, , refFile, hypFile] = process.argv;
if (!refFile || !hypFile) {
  console.error("usage: node bench/asr-wer.mjs <REFERENCE.txt> <HYPOTHESIS.txt>");
  process.exit(1);
}

const ref = (await readFile(refFile, "utf8")).trim();
const hyp = (await readFile(hypFile, "utf8")).trim();
const r = wordErrorRate(ref, hyp);

console.log(`REF (${refFile}): ${ref}`);
console.log(`HYP (${hypFile}): ${hyp}`);
console.log("");
console.log(`wordAccuracy = ${r.wordAccuracy}%   WER = ${r.wer}`);
console.log(`exactMatches = ${r.exactMatches}`);
console.log(
  `phoneticMatches (forgiven homophones) = ${
    r.phoneticMatches.length
  } ${JSON.stringify(r.phoneticMatches)}`,
);
console.log(
  `missaidWords (substitutions) = ${r.missaidWords.length} ${JSON.stringify(
    r.missaidWords,
  )}`,
);
console.log(`missedWords (deletions) = ${r.missedWords.length} ${JSON.stringify(r.missedWords)}`);
console.log(`extraWords (insertions) = ${r.extraWords.length} ${JSON.stringify(r.extraWords)}`);
