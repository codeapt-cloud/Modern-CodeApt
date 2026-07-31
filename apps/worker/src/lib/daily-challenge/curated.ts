/**
 * Built-in curated fallback pool for the daily-challenge generator — the
 * GUARANTEED floor. When both AI generation and the global coding bank are
 * unavailable (e.g. a fresh install with no bank questions, or an LLM/Piston
 * outage), the pipeline publishes one of these so a valid challenge is NEVER
 * missing. They are simple, self-contained stdin→stdout problems (the same
 * shape the daily engine grades) and are trusted as-authored — they are NOT
 * re-validated by execution, precisely so they still publish when Piston is
 * down. Provenance is marked `curated_fallback` (honest: not AI, not the bank).
 */
import { CodeLanguage } from "@codeapt/shared";

export interface CuratedChallenge {
  title: string;
  description: string;
  starterCode: string;
  language: CodeLanguage;
  testCases: { input: string; expectedOutput: string; isHidden: boolean }[];
}

const PY = CodeLanguage.PYTHON;

export const CURATED_CHALLENGES: CuratedChallenge[] = [
  {
    title: "Greet the visitor",
    description:
      "Read a single line — a name — from standard input and print exactly `Hello, <name>!`.",
    starterCode: "name = input()\n# print the greeting\n",
    language: PY,
    testCases: [
      { input: "Ada", expectedOutput: "Hello, Ada!", isHidden: false },
      { input: "Grace", expectedOutput: "Hello, Grace!", isHidden: false },
      { input: "Linus", expectedOutput: "Hello, Linus!", isHidden: true },
    ],
  },
  {
    title: "Sum of two integers",
    description:
      "Read two integers on separate lines and print their sum.",
    starterCode: "a = int(input())\nb = int(input())\n# print the sum\n",
    language: PY,
    testCases: [
      { input: "2\n3", expectedOutput: "5", isHidden: false },
      { input: "-4\n10", expectedOutput: "6", isHidden: false },
      { input: "100\n250", expectedOutput: "350", isHidden: true },
    ],
  },
  {
    title: "Reverse a string",
    description:
      "Read a single line and print it reversed.",
    starterCode: "s = input()\n# print s reversed\n",
    language: PY,
    testCases: [
      { input: "hello", expectedOutput: "olleh", isHidden: false },
      { input: "codeapt", expectedOutput: "tpaedoc", isHidden: false },
      { input: "racecar", expectedOutput: "racecar", isHidden: true },
    ],
  },
  {
    title: "Count the vowels",
    description:
      "Read a single lowercase word and print how many vowels (a, e, i, o, u) it contains.",
    starterCode: "s = input()\n# print the vowel count\n",
    language: PY,
    testCases: [
      { input: "banana", expectedOutput: "3", isHidden: false },
      { input: "rhythm", expectedOutput: "0", isHidden: false },
      { input: "education", expectedOutput: "5", isHidden: true },
    ],
  },
];
