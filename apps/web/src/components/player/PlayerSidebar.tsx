import type { ModuleNode, TopicType } from "@codeapt/shared";
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  Gamepad2,
  Mic,
  MessagesSquare,
  PenLine,
  PlayCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/cn.js";
import { Progress } from "../ui/progress.js";

const TYPE_ICON: Record<TopicType, LucideIcon> = {
  text: FileText,
  video: PlayCircle,
  quiz: ClipboardList,
  exam: ClipboardList,
  essay: PenLine,
  game: Gamepad2,
  speaking: Mic,
  communication: MessagesSquare,
};

export function PlayerSidebar({
  modules,
  currentTopicId,
  completed,
  percentage,
  onSelect,
}: {
  modules: ModuleNode[];
  currentTopicId: string;
  completed: Record<string, boolean>;
  percentage: number;
  onSelect: (topicId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-subtle p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-ink-secondary">Your progress</span>
          <span className="font-mono text-ink">{percentage}%</span>
        </div>
        <Progress value={percentage} />
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {modules.map((module, mi) => (
          <div key={module.id} className="mb-4">
            <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <span className="mr-1.5 font-mono">
                {String(mi + 1).padStart(2, "0")}
              </span>
              {module.name}
            </p>
            <ul className="space-y-0.5">
              {module.topics.map((topic) => {
                const Icon = TYPE_ICON[topic.topicType];
                const isDone = completed[topic.id] ?? topic.isCompleted;
                const isCurrent = topic.id === currentTopicId;
                return (
                  <li key={topic.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(topic.id)}
                      aria-current={isCurrent ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focus",
                        isCurrent
                          ? "bg-primary/15 text-primary"
                          : "text-ink-secondary hover:bg-surface-overlay hover:text-ink",
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success-fg" />
                      ) : (
                        <Circle
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isCurrent ? "text-primary" : "text-ink-muted",
                          )}
                        />
                      )}
                      <Icon className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="flex-1 leading-snug">{topic.name}</span>
                      {topic.duration ? (
                        <span className="text-xs text-ink-muted">
                          {topic.duration}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
