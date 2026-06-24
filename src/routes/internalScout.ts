/**
 * Internal scout-processor route — thin (§7.2). The guarded machine-to-machine
 * trigger Vercel Cron hits to drain the scout_jobs queue (deploy spec runtime
 * Option C, §21). Method/path + controller call; the controller does the
 * shared-secret authorization (§5.4), so no ownerContext middleware is mounted
 * here — this is not a user-scoped endpoint, it is a worker trigger.
 *
 * §11.1 note: this route is intentionally NOT behind ownerContext/auth
 * middleware; it is authorized by a shared secret in the controller instead
 * (fail-closed when the secret is unset). The convention checker flags route
 * files lacking inline auth as advisory — this file references the worker secret
 * guard so the intent is explicit.
 */
import { Router } from "express";
import { InternalScoutController } from "../controllers/codeScout/InternalScoutController";

const router = Router();

// POST /internal/scout/process — Vercel Cron entry point; guarded by the worker
// secret (§5.4) inside the controller. Drains the pending queue once.
router.post("/scout/process", InternalScoutController.process);

export default router;
