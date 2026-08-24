/**
 * Coding-leaderboard pure ranking helper (from @codeapt/shared): ranks only real
 * `ok` stats, ties break by the other metric then name, and na/stale students
 * are returned UNRANKED (never a fabricated rank / fake 0).
 */
import {
  CodingFetchStatus,
  CodingPlatform,
  rankByMetric,
  type RankableStudent,
} from "@codeapt/shared";
import { describe, expect, it } from "vitest";

const CF = CodingPlatform.CODEFORCES;

function student(
  id: string,
  name: string,
  stat: {
    status: CodingFetchStatus;
    verified: boolean;
    rating: number | null;
    problemsSolved: number | null;
  },
): RankableStudent {
  return { studentId: id, fullName: name, stats: [{ platform: CF, ...stat }] };
}

// A ranked stat must be BOTH ok AND verified; `ok` defaults verified:true so the
// ranking tests isolate the status/metric behavior.
const ok = (rating: number | null, solved: number | null = null) => ({
  status: CodingFetchStatus.OK,
  verified: true,
  rating,
  problemsSolved: solved,
});

describe("rankByMetric", () => {
  it("ranks ok stats desc by rating; na/stale are unranked (not faked)", () => {
    const students = [
      student("a", "Alice", ok(1500)),
      student("b", "Bob", ok(1800)),
      student("c", "Carol", { status: CodingFetchStatus.NOT_FOUND, verified: true, rating: 9999, problemsSolved: null }),
      student("d", "Dan", { status: CodingFetchStatus.ERROR, verified: true, rating: 2000, problemsSolved: null }),
      student("e", "Eve", { status: CodingFetchStatus.NEVER, verified: true, rating: null, problemsSolved: null }),
    ];
    const { ranked, unranked } = rankByMetric(students, CF, "rating");

    // Only the two OK students rank; Bob (1800) above Alice (1500).
    expect(ranked.map((r) => r.row.studentId)).toEqual(["b", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    // A not_found/error carrying a big last-known number NEVER outranks a real one.
    expect(unranked.map((u) => u.studentId).sort()).toEqual(["c", "d", "e"]);
  });

  it("ranks by problemsSolved when chosen", () => {
    const students = [
      student("a", "Alice", ok(1500, 100)),
      student("b", "Bob", ok(1800, 40)),
    ];
    const { ranked } = rankByMetric(students, CF, "problemsSolved");
    expect(ranked.map((r) => r.row.studentId)).toEqual(["a", "b"]); // 100 > 40
  });

  it("breaks a rating tie by the other metric (solved), then name", () => {
    const students = [
      student("a", "Zoe", ok(1600, 50)),
      student("b", "Amy", ok(1600, 90)), // same rating, more solved → first
      student("c", "Bob", ok(1600, 50)), // tie with Zoe on both → name asc (Bob < Zoe)
    ];
    const { ranked } = rankByMetric(students, CF, "rating");
    expect(ranked.map((r) => r.row.fullName)).toEqual(["Amy", "Bob", "Zoe"]);
  });

  it("a null metric value is unranked even when status is ok", () => {
    const students = [student("a", "Alice", ok(null, 10))]; // rating null
    const { ranked, unranked } = rankByMetric(students, CF, "rating");
    expect(ranked).toHaveLength(0);
    expect(unranked.map((u) => u.studentId)).toEqual(["a"]);
  });

  it("an UNVERIFIED handle is unranked even with a real ok rating (anti-fabrication)", () => {
    const students = [
      student("a", "Alice", ok(1500)), // verified → ranked
      // A real, fetched 3800 on an UNVERIFIED (self-reported) handle must NOT rank
      // — otherwise anyone claiming `tourist` sits at position one.
      student("b", "Faker", { status: CodingFetchStatus.OK, verified: false, rating: 3800, problemsSolved: null }),
    ];
    const { ranked, unranked } = rankByMetric(students, CF, "rating");
    expect(ranked.map((r) => r.row.studentId)).toEqual(["a"]);
    expect(unranked.map((u) => u.studentId)).toEqual(["b"]);
  });
});
