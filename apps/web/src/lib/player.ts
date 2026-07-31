/**
 * Pure helpers for the course player: flattening the module→topic tree into an
 * ordered list, prev/next navigation, resume point, and quiz choice display
 * state. Kept side-effect-free so they're unit-testable.
 */
import type { ModuleNode, TopicNode } from "@codeapt/shared";

export interface FlatTopic {
  topic: TopicNode;
  moduleId: string;
  moduleName: string;
  /** 0-based position in the flattened, ordered list. */
  index: number;
}

/** Flatten modules (already ordered by the API) into a single topic list. */
export function flattenTopics(modules: ModuleNode[]): FlatTopic[] {
  const flat: FlatTopic[] = [];
  for (const module of modules) {
    for (const topic of module.topics) {
      flat.push({
        topic,
        moduleId: module.id,
        moduleName: module.name,
        index: flat.length,
      });
    }
  }
  return flat;
}

export interface Adjacent {
  index: number;
  current: FlatTopic | undefined;
  prev: FlatTopic | undefined;
  next: FlatTopic | undefined;
}

export function getAdjacent(flat: FlatTopic[], topicId: string): Adjacent {
  const index = flat.findIndex((f) => f.topic.id === topicId);
  return {
    index,
    current: index >= 0 ? flat[index] : undefined,
    prev: index > 0 ? flat[index - 1] : undefined,
    next: index >= 0 && index < flat.length - 1 ? flat[index + 1] : undefined,
  };
}

/**
 * The topic to resume at: the first not-completed topic, or the first topic if
 * all are complete, or undefined if there are none. `completed` overrides the
 * node's own `isCompleted` (so optimistic UI state wins).
 */
export function firstIncompleteTopicId(
  flat: FlatTopic[],
  completed: Record<string, boolean>,
): string | undefined {
  if (flat.length === 0) return undefined;
  const target = flat.find(
    (f) => !(completed[f.topic.id] ?? f.topic.isCompleted),
  );
  return (target ?? flat[0])?.topic.id;
}

export type ChoiceOutcome =
  | "correct" // was correct and the user selected it
  | "missed" // was correct but the user did not select it
  | "wrong" // was incorrect but the user selected it
  | "neutral"; // incorrect and not selected

/** Display state for a single choice AFTER grading (drives result colours). */
export function getChoiceOutcome(
  choiceId: string,
  selectedChoiceIds: string[],
  correctChoiceIds: string[],
): ChoiceOutcome {
  const correct = correctChoiceIds.includes(choiceId);
  const selected = selectedChoiceIds.includes(choiceId);
  if (correct && selected) return "correct";
  if (correct && !selected) return "missed";
  if (!correct && selected) return "wrong";
  return "neutral";
}
