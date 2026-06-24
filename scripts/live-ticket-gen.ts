/**
 * ONE live ticket generation against the real model + DB (spec verification step 5).
 * Seeds a synthetic decision_record for a session (cheaper than a full interview),
 * generates a ticket with the real claude-opus-4-8, then edits + comments +
 * finalizes and fetches the Markdown. NOT a test — a manual verification harness.
 * Cleans up its synthetic rows (owner id > 1000) on the way out.
 */
import { db } from "../src/database/connection";
import { TICKET_GENERATION } from "../src/config";
import { DecisionRecordModel } from "../src/models/DecisionRecordModel";
import { InterviewSessionModel } from "../src/models/InterviewSessionModel";
import { TicketGenerationService } from "../src/controllers/ticket/feature-services/TicketGenerationService";
import { TicketService } from "../src/controllers/ticket/feature-services/TicketService";
import type { OwnerContext } from "../src/types/interview";

const owner: OwnerContext = { ownerUserId: 9001, organizationId: null };

async function main(): Promise<void> {
  await db.migrate.latest();

  const session = await InterviewSessionModel.create(owner, {
    originalRequest:
      "Add a way for signed-in users to export their project data as a downloadable file.",
  });
  await DecisionRecordModel.createMany([
    { sessionId: session.id, key: "export_format", value: { optionId: "csv" }, source: "answer" },
    { sessionId: session.id, key: "scope", value: { otherText: "only the requesting user's own projects" }, source: "answer" },
    { sessionId: session.id, key: "delivery", value: { optionId: "synchronous_download" }, source: "answer" },
    { sessionId: session.id, key: "auth_required", value: { optionId: "yes_signed_in_only" }, source: "answer" },
  ]);

  console.log(`\n[live] model = ${TICKET_GENERATION.MODEL}, effort = ${TICKET_GENERATION.EFFORT}`);
  console.log(`[live] generating ticket for session ${session.id}…`);

  const ticket = await TicketGenerationService.generateForSession(session.id, owner);

  console.log("\n=== GENERATED TICKET (persisted) ===");
  console.log(JSON.stringify(
    {
      id: ticket.id,
      status: ticket.status,
      version: ticket.version,
      user_story: ticket.user_story,
      effort: ticket.effort,
      acceptance_criteria: ticket.acceptance_criteria,
      context_summary: ticket.context_summary,
    },
    null,
    2,
  ));

  // Edit a field (version-guarded) — should bump to v2.
  const edited = await TicketService.updateForOwner(ticket.id, owner, {
    expectedVersion: ticket.version,
    effort: "S",
  });
  console.log(`\n[live] after edit: version ${ticket.version} -> ${edited.ticket.version}, effort -> ${edited.ticket.effort}`);

  // Add a comment.
  const comment = await TicketService.addCommentForOwner(
    ticket.id,
    owner,
    "Confirm CSV column set with data team before build.",
  );
  console.log(`[live] added comment id ${comment.id} by user ${comment.author_user_id}`);

  // Finalize (version-guarded) — should flip to final + bump to v3.
  const finalized = await TicketService.finalizeForOwner(
    ticket.id,
    owner,
    edited.ticket.version,
  );
  console.log(`[live] after finalize: status -> ${finalized.ticket.status}, version -> ${finalized.ticket.version}, comments = ${finalized.comments.length}`);

  // Fetch the canonical Markdown.
  const fetched = await TicketService.getForOwner(ticket.id, owner);
  console.log("\n=== RENDERED MARKDOWN (tickets.rendered_markdown) ===");
  console.log(fetched.ticket.rendered_markdown);

  // Cleanup synthetic rows (cascade from the session).
  await db("interview_sessions").where("owner_user_id", owner.ownerUserId).del();
  console.log("\n[live] cleaned up synthetic rows. DONE.");
}

main()
  .then(() => db.destroy())
  .catch(async (error) => {
    console.error("[live] FAILED:", error);
    await db("interview_sessions").where("owner_user_id", owner.ownerUserId).del().catch(() => undefined);
    await db.destroy();
    process.exit(1);
  });
