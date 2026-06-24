/**
 * MaterialityGateService — decides whether the interview should generate
 * another batch or terminate (spec T4). Pure decision logic: no DB, no req/res
 * (§6.3, §7.1). Together with the hard max-rounds cap it kills the
 * "interview goes on and on" failure mode (spec Risk).
 *
 * A batch is generated only when an open decision would still materially change
 * the ticket AND the round cap is not yet reached. A global "stop and generate
 * now" or hitting the cap forces termination at shared understanding.
 */
import { INTERVIEW_ENGINE } from "../../../config";

/** Why the gate decided to continue or stop — surfaced for logging/clients. */
export type GateReason =
  | "first_batch"
  | "open_material_decisions"
  | "no_material_decisions"
  | "max_rounds_reached"
  | "stopped_by_user";

export interface GateDecision {
  /** True when the engine should generate another batch. */
  shouldGenerate: boolean;
  /** True when the interview has reached a terminal state. */
  isComplete: boolean;
  reason: GateReason;
}

export interface GateInputs {
  /** Number of batches already generated and persisted (turns.length). */
  roundsSoFar: number;
  /**
   * Whether the most recent generated batch signalled open material decisions.
   * Undefined before any batch has been generated.
   */
  hasOpenMaterialDecisions?: boolean;
  /** Global escape: the PM asked to stop and generate the ticket now. */
  stopRequested?: boolean;
}

export class MaterialityGateService {
  static get maxRounds(): number {
    return INTERVIEW_ENGINE.MAX_ROUNDS;
  }

  /**
   * Decide whether to generate the next batch. Precedence:
   * 1. A user "stop and generate" always terminates immediately.
   * 2. The hard round cap always terminates (the non-negotiable backstop).
   * 3. Otherwise generate only if an open decision is still material; the very
   *    first batch (no prior signal) is always generated.
   */
  static decide(inputs: GateInputs): GateDecision {
    if (inputs.stopRequested) {
      return { shouldGenerate: false, isComplete: true, reason: "stopped_by_user" };
    }

    if (inputs.roundsSoFar >= this.maxRounds) {
      return {
        shouldGenerate: false,
        isComplete: true,
        reason: "max_rounds_reached",
      };
    }

    // No batch generated yet → always generate the first one.
    if (inputs.roundsSoFar === 0 && inputs.hasOpenMaterialDecisions === undefined) {
      return { shouldGenerate: true, isComplete: false, reason: "first_batch" };
    }

    if (inputs.hasOpenMaterialDecisions) {
      return {
        shouldGenerate: true,
        isComplete: false,
        reason: "open_material_decisions",
      };
    }

    // Shared understanding reached: nothing material left to ask.
    return {
      shouldGenerate: false,
      isComplete: true,
      reason: "no_material_decisions",
    };
  }
}
