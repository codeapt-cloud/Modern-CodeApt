/**
 * Model barrel. Importing this module registers every Mongoose model exactly
 * once (side effect of each model file). The API imports it on boot so all
 * collections/indexes are known before the first request.
 */
export * from "./user.model.js";
export * from "./refresh-session.model.js";
export * from "./curriculum.model.js";
export * from "./commerce.model.js";
export * from "./careers.model.js";
export * from "./assessment.model.js";
export * from "./challenge.model.js";
export * from "./essay.model.js";
export * from "./execution.model.js";
export * from "./ai-provider.model.js";
export * from "./ai-usage.model.js";
export * from "./college.model.js";
export * from "./org-unit.model.js";
export * from "./question-bank.model.js";
export * from "./attendance-group.model.js";
export * from "./attendance-session.model.js";
export * from "./coding-profile.model.js";
export * from "./ai-credit.model.js";
export * from "./student-ai-credit.model.js";
export * from "./ai-governor.model.js";
export * from "./game.model.js";
