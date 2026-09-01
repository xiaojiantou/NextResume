// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TURNS,
  REFINE_SYSTEM,
  buildRefineUserMessage,
  normalizeTurns,
} from "../lib/refineBullet.ts";

const base = {
  instruction: "强调是我主导的架构设计",
  originalBullet: "Built a production Agentic AI platform in pooling cut p95 API latency ~40%.",
  originalBulletId: "b1",
  turns: [],
  job: { title: "Software Engineer Intern", requiredKeywords: ["Go"] },
};

test("the original bullet is present and labelled as the language anchor", () => {
  // A Chinese instruction against an English bullet must still produce English,
  // so the model has to be told which text sets the language.
  const msg = buildRefineUserMessage(base);
  assert.ok(msg.includes(base.originalBullet));
  assert.match(msg, /ORIGINAL BULLET[^\n]*match this language/);
  assert.ok(msg.includes("id=b1"));
});

test("the system prompt pins output language to the bullet, not the instruction", () => {
  assert.match(REFINE_SYSTEM, /SAME LANGUAGE as the ORIGINAL BULLET/);
  assert.match(REFINE_SYSTEM, /never the language of the instruction/);
});

test("the anti-fabrication rules survived the rewrite of this prompt", () => {
  assert.match(REFINE_SYSTEM, /Use ONLY facts the candidate stated/);
  assert.match(REFINE_SYSTEM, /Never fabricate a number/);
});

test("earlier rounds are included, in order, before the latest instruction", () => {
  const msg = buildRefineUserMessage({
    ...base,
    instruction: "now make it shorter",
    turns: [
      { instruction: "mention Google Cloud", result: "Built … on Google Cloud …" },
      { instruction: "drop the pooling detail", result: "Built … on Google Cloud." },
    ],
  });

  const first = msg.indexOf("mention Google Cloud");
  const second = msg.indexOf("drop the pooling detail");
  const latest = msg.indexOf("now make it shorter");

  assert.ok(first > -1 && second > -1 && latest > -1);
  assert.ok(first < second, "rounds must keep their order");
  assert.ok(second < latest, "the latest instruction comes last");
  assert.match(msg, /Round 1/);
  assert.match(msg, /Round 2/);
});

test("a conversation refines the version on screen, not the original", () => {
  const msg = buildRefineUserMessage({
    ...base,
    current: "Built a production Agentic AI platform on Google Cloud.",
  });
  assert.match(msg, /CURRENT BULLET[\s\S]*on Google Cloud/);
});

test("with no history the earlier-rounds block is omitted entirely", () => {
  assert.ok(!buildRefineUserMessage(base).includes("EARLIER ROUNDS"));
});

test("current falls back to the original when the caller omits it", () => {
  const msg = buildRefineUserMessage({ ...base, current: undefined });
  assert.match(msg, /CURRENT BULLET[\s\S]*Built a production Agentic AI platform/);
});

// A round whose request failed leaves an instruction with no result; sending
// it would tell the model it produced something it never produced.
test("half-formed rounds are dropped", () => {
  assert.deepEqual(
    normalizeTurns([
      { instruction: "make it shorter", result: "Built …" },
      { instruction: "add metrics" },
      { result: "orphaned" },
      { instruction: "   ", result: "   " },
    ]),
    [{ instruction: "make it shorter", result: "Built …" }],
  );
});

test("normalizeTurns tolerates missing input", () => {
  assert.deepEqual(normalizeTurns(undefined), []);
  assert.deepEqual(normalizeTurns([]), []);
});

test("turns are trimmed so whitespace cannot pad the history", () => {
  assert.deepEqual(
    normalizeTurns([{ instruction: "  shorter\n", result: "\tBuilt …  " }]),
    [{ instruction: "shorter", result: "Built …" }],
  );
});

test("the turn cap is a number the UI can honour", () => {
  assert.equal(typeof MAX_TURNS, "number");
  assert.ok(MAX_TURNS >= 2 && MAX_TURNS <= 20);
});
