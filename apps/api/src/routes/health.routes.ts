import { Router } from "express";

import { healthController } from "../controllers/health.controller.js";

export const healthRouter: Router = Router();

healthRouter.get("/health", healthController);
