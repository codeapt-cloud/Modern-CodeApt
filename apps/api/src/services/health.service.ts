/**
 * Health service — assembles the health payload. Business logic lives in
 * services; controllers stay thin.
 */
import type { HealthResponse } from "@codeapt/shared";

import { getDbStatus } from "../lib/db.js";

export function getHealth(): HealthResponse {
  const database = getDbStatus();
  return {
    status: database === "connected" ? "ok" : "degraded",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: { database },
  };
}
