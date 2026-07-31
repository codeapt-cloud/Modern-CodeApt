/**
 * Health controller — thin: delegates to the service and shapes the response.
 */
import type { Request, Response } from "express";

import { getHealth } from "../services/health.service.js";

export function healthController(_req: Request, res: Response): void {
  const health = getHealth();
  // 200 when the DB is connected, 503 when degraded, so probes can act on it.
  res.status(health.status === "ok" ? 200 : 503).json(health);
}
