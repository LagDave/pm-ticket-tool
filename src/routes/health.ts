/**
 * Health route — thin (§7.2). No auth: a health probe is a legitimate public
 * endpoint (§11.1 confirmed exception). Routes through controller → service →
 * model so layering holds even here (§7.1).
 */
import { Router } from "express";
import { HealthController } from "../controllers/health/HealthController";

const router = Router();

router.get("/", HealthController.check);

export default router;
