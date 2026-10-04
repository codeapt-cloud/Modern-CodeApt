/** Admin Assistant service (Step 40: read-only GUIDE) — public surface. */
export { handleChat } from "./chat.js";
export { dispatchRead } from "./dispatch.js";
export { ADMIN_ASSISTANT_TOOLS, getTool } from "./registry.js";
export { ADMIN_CAPABILITIES, lookupCapabilities } from "./capabilities.js";
export type { AssistantContext } from "./types.js";
