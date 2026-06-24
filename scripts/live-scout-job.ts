/**
 * ONE live background-scout run (deploy runtime Option C verification). Seeds a
 * synthetic session, ENQUEUES a scan (must return fast — no inline scan), then
 * runs the processor once (the REAL Git Trees/Contents API + real claude model,
 * within the caps) and confirms scout_cache is written + the job is done + the
 * status endpoint reports done with findings. NOT a test — a manual verification
 * harness. Cleans up its synthetic rows (owner id > 1000) on the way out.
 */
import { db } from "../src/database/connection";
import { SCOUT } from "../src/config";
import { CodeScoutService } from "../src/controllers/codeScout/feature-services/CodeScoutService";
import { ScoutJobProcessor } from "../src/services/scoutJobs/ScoutJobProcessor";
import { ScoutJobModel } from "../src/models/ScoutJobModel";
import { InterviewSessionModel } from "../src/models/InterviewSessionModel";
import type { OwnerContext } from "../src/types/interview";

const owner: OwnerContext = { ownerUserId: 9501, organizationId: null };
const repo = { provider: "github" as const, repoRef: "expressjs/cors" };

async function main(): Promise<void> {
  await db.migrate.latest();

  const session = await InterviewSessionModel.create(owner, {
    originalRequest:
      "Add support for configuring allowed CORS origins from a database at runtime.",
  });
  console.log(`\n[live] model = ${SCOUT.MODEL}, effort = ${SCOUT.EFFORT}`);
  console.log(`[live] session ${session.id}; repo = ${repo.provider}:${repo.repoRef}`);

  // 1) ENQUEUE — must be fast (no scan inline). Time it.
  const t0 = Date.now();
  const enqueued = await CodeScoutService.enqueueScan(session.id, owner, repo);
  const enqueueMs = Date.now() - t0;
  console.log(
    `\n[live] enqueue returned in ${enqueueMs}ms — jobId=${enqueued.jobId}, status=${enqueued.status}, alreadyComplete=${enqueued.alreadyComplete}`,
  );
  if (enqueued.alreadyComplete || enqueued.jobId === null) {
    throw new Error("[live] expected a fresh job to be enqueued, got a short-circuit");
  }

  // 2) Status BEFORE processing — pending, no findings (spec 6 falls back here).
  const before = await CodeScoutService.getScanStatus(session.id, owner);
  console.log(`[live] status before processing: ${before.status}, findings present: ${before.findings !== undefined}`);

  // 3) Run the processor once — the REAL scan happens here (out of band).
  console.log(`\n[live] running the processor (real scan, bounded by the caps)…`);
  const ts = Date.now();
  const drained = await ScoutJobProcessor.drain();
  const scanMs = Date.now() - ts;
  console.log(`[live] processor drained ${drained} job(s) in ${scanMs}ms`);

  // 4) Confirm the cache + job + status.
  const after = await CodeScoutService.getScanStatus(session.id, owner);
  const job = await ScoutJobModel.findById(enqueued.jobId);
  console.log("\n=== RESULT ===");
  console.log(`[live] job ${enqueued.jobId}: status=${job?.status}, attempts=${job?.attempts}, last_error=${job?.last_error ?? "null"}`);
  console.log(`[live] status endpoint: ${after.status}, findings present: ${after.findings !== undefined}, verifyWithEngineering: ${after.findings?.verifyWithEngineering}`);
  if (after.findings) {
    console.log(`[live] summary: ${after.findings.summary}`);
    console.log(`[live] areas (${after.findings.relevantAreas.length}):`);
    for (const a of after.findings.relevantAreas) {
      console.log(`   - ${a.area} [${a.roughSize}/${a.feasibility}] touches: ${a.whatItTouches.join(", ")}`);
    }
  }

  const ok =
    job?.status === "done" &&
    after.status === "done" &&
    after.findings !== undefined &&
    after.findings.verifyWithEngineering === true &&
    enqueueMs < scanMs; // the enqueue was fast; the scan was the slow part
  console.log(`\n[live] BACKGROUND-FLOW OK: ${ok} (enqueue ${enqueueMs}ms << scan ${scanMs}ms)`);

  // 5) Cleanup synthetic rows (cascade from the session clears job + cache).
  await db("interview_sessions").where("owner_user_id", owner.ownerUserId).del();
  console.log("[live] cleaned up synthetic rows. DONE.");
  if (!ok) throw new Error("[live] background flow did not satisfy the expected end state");
}

main()
  .then(() => db.destroy())
  .catch(async (error) => {
    console.error("[live] FAILED:", error);
    await db("interview_sessions").where("owner_user_id", owner.ownerUserId).del().catch(() => undefined);
    await db.destroy();
    process.exit(1);
  });
