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
