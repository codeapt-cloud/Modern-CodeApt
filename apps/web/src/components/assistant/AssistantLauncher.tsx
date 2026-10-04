/**
 * AssistantLauncher (Step 39) — the chrome button that opens the assistant panel.
 * It carries the scope (platform, or a specific college) so the provider talks to
 * the right endpoint. VISIBILITY is decided by the caller (the shell) via the pure
 * assistant-availability rules — a college without the capability renders no
 * launcher at all, so this component assumes it is only mounted when allowed.
 */
import { Sparkles } from "lucide-react";

import {
  useAssistant,
  type AssistantScope,
} from "../../providers/AssistantProvider.js";
import { Button } from "../ui/button.js";

export function AssistantLauncher({ scope }: { scope: AssistantScope }) {
  const { openPanel, open } = useAssistant();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => openPanel(scope)}
      aria-label="Open admin assistant"
      aria-expanded={open}
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Assistant</span>
    </Button>
  );
}
