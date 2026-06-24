/**
 * MaterialityGateService tests (§20.1, §20.2). Pure decision logic — no DB, no
 * model. Proves the two termination guarantees from the spec: a request with no
 * open material decisions terminates, and the round count never exceeds the cap;
 * plus the "stop and generate" escape and first-batch behavior.
 */
import { describe, expect, it } from "vitest";
import { INTERVIEW_ENGINE } from "../../../config";
import { MaterialityGateService } from "./MaterialityGateService";

describe("MaterialityGateService", () => {
  it("generates the first batch when none exists yet", () => {
    const decision = MaterialityGateService.decide({ roundsSoFar: 0 });
    expect(decision.shouldGenerate).toBe(true);
    expect(decision.isComplete).toBe(false);
    expect(decision.reason).toBe("first_batch");
  });

  it("generates another batch while material decisions remain open", () => {
    const decision = MaterialityGateService.decide({
      roundsSoFar: 1,
      hasOpenMaterialDecisions: true,
    });
    expect(decision.shouldGenerate).toBe(true);
    expect(decision.isComplete).toBe(false);
    expect(decision.reason).toBe("open_material_decisions");
  });

  it("terminates when no material decisions remain (shared understanding)", () => {
    const decision = MaterialityGateService.decide({
      roundsSoFar: 2,
      hasOpenMaterialDecisions: false,
    });
    expect(decision.shouldGenerate).toBe(false);
    expect(decision.isComplete).toBe(true);
    expect(decision.reason).toBe("no_material_decisions");
  });

  it("never exceeds the hard round cap, even with decisions still open", () => {
    const decision = MaterialityGateService.decide({
      roundsSoFar: INTERVIEW_ENGINE.MAX_ROUNDS,
      hasOpenMaterialDecisions: true, // still wants more — cap must win
    });
    expect(decision.shouldGenerate).toBe(false);
    expect(decision.isComplete).toBe(true);
    expect(decision.reason).toBe("max_rounds_reached");
  });

  it("stops immediately on a global stop-and-generate request", () => {
    const decision = MaterialityGateService.decide({
      roundsSoFar: 1,
      hasOpenMaterialDecisions: true,
      stopRequested: true,
    });
    expect(decision.shouldGenerate).toBe(false);
    expect(decision.isComplete).toBe(true);
    expect(decision.reason).toBe("stopped_by_user");
  });

  it("stop request wins even at round zero", () => {
    const decision = MaterialityGateService.decide({
      roundsSoFar: 0,
      stopRequested: true,
    });
    expect(decision.shouldGenerate).toBe(false);
    expect(decision.reason).toBe("stopped_by_user");
  });
});
