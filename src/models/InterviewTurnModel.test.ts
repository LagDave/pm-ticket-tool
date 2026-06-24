/**
 * InterviewTurnModel + DecisionRecordModel tests (§20.1). Proves the JSONB
 * write-through round-trips structured values (not strings) for resume-replay.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../database/connection";
import { makeOwner, makeRequestText } from "../test/factories";
import { DecisionRecordModel } from "./DecisionRecordModel";
import { InterviewSessionModel } from "./InterviewSessionModel";
import { InterviewTurnModel } from "./InterviewTurnModel";

describe("InterviewTurnModel + DecisionRecordModel", () => {
  let sessionId: number;

  beforeAll(async () => {
    const owner = makeOwner();
    const session = await InterviewSessionModel.create(owner, {
      originalRequest: makeRequestText("turns"),
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await db("interview_sessions").where("id", sessionId).del(); // cascades children
  });

  it("round-trips JSONB questions/answers as structured values", async () => {
    const questions = [{ id: "q1", text: "Link format?", options: ["a", "b"] }];
    const answers = { q1: "a" };

    const turn = await InterviewTurnModel.create({
      sessionId,
      turnIndex: 0,
      questions,
      answers,
    });

    expect(turn.id).toBeGreaterThan(0);
    expect(turn.questions).toEqual(questions);
    expect(turn.answers).toEqual(answers);

    const list = await InterviewTurnModel.listBySession(sessionId);
    expect(list.length).toBe(1);
    expect(list[0].questions).toEqual(questions);
  });

  it("stores a decision record with a structured value", async () => {
    const value = { chosen: "magic_link", ttlMinutes: 15 };
    const record = await DecisionRecordModel.create({
      sessionId,
      key: "link_format",
      value,
      source: "answer",
    });

    expect(record.value).toEqual(value);
    expect(record.source).toBe("answer");

    const list = await DecisionRecordModel.listBySession(sessionId);
    expect(list.length).toBe(1);
    expect(list[0].key).toBe("link_format");
  });
});
