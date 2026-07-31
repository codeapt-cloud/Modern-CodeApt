/**
 * Unit tests for the pure player helpers (flatten / prev-next / resume /
 * quiz choice display state).
 */
import type { ModuleNode, TopicNode } from "@codeapt/shared";
import { describe, expect, it } from "vitest";

import {
  firstIncompleteTopicId,
  flattenTopics,
  getAdjacent,
  getChoiceOutcome,
} from "../src/lib/player.js";

function topic(id: string, isCompleted = false): TopicNode {
  return {
    id,
    name: `Topic ${id}`,
    topicType: "text",
    order: 1,
    duration: "5 min",
    isLocked: false,
    isCompleted,
  };
}

const modules: ModuleNode[] = [
  {
    id: "m1",
    name: "Module 1",
    order: 1,
    topics: [topic("a"), topic("b", true)],
  },
  { id: "m2", name: "Module 2", order: 2, topics: [topic("c")] },
];

describe("flattenTopics", () => {
  it("flattens modules into an ordered list with indices and module info", () => {
    const flat = flattenTopics(modules);
    expect(flat.map((f) => f.topic.id)).toEqual(["a", "b", "c"]);
    expect(flat.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(flat[2]!.moduleName).toBe("Module 2");
  });
});

describe("getAdjacent", () => {
  it("computes prev/next with boundaries", () => {
    const flat = flattenTopics(modules);
    expect(getAdjacent(flat, "a").prev).toBeUndefined();
    expect(getAdjacent(flat, "a").next?.topic.id).toBe("b");
    expect(getAdjacent(flat, "b").prev?.topic.id).toBe("a");
    expect(getAdjacent(flat, "b").next?.topic.id).toBe("c");
    expect(getAdjacent(flat, "c").next).toBeUndefined();
  });
});

describe("firstIncompleteTopicId", () => {
  const flat = flattenTopics(modules);
  it("returns the first topic whose completion is falsy (node default)", () => {
    // 'a' not complete by default → first incomplete.
    expect(firstIncompleteTopicId(flat, {})).toBe("a");
  });
  it("respects the override map over node.isCompleted", () => {
    expect(firstIncompleteTopicId(flat, { a: true })).toBe("c"); // a done, b done(node) → c
  });
  it("falls back to the first topic when all complete", () => {
    expect(firstIncompleteTopicId(flat, { a: true, b: true, c: true })).toBe(
      "a",
    );
  });
  it("returns undefined with no topics", () => {
    expect(firstIncompleteTopicId([], {})).toBeUndefined();
  });
});

describe("getChoiceOutcome", () => {
  it("classifies each choice after grading", () => {
    const correct = ["x", "y"];
    const selected = ["x", "z"];
    expect(getChoiceOutcome("x", selected, correct)).toBe("correct"); // right + picked
    expect(getChoiceOutcome("y", selected, correct)).toBe("missed"); // right, not picked
    expect(getChoiceOutcome("z", selected, correct)).toBe("wrong"); // wrong, picked
    expect(getChoiceOutcome("w", selected, correct)).toBe("neutral"); // wrong, not picked
  });
});
