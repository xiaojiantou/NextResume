import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleOptimization,
  buildChunkPrompt,
  chunkKey,
  chunksForIssues,
  mapWithConcurrency,
  planRewriteChunks,
} from "../lib/optimizeChunks.ts";
import { normalizeOptimization } from "../lib/optimizeContract.ts";

const resume = {
  name: "Candidate",
  title: "Engineer",
  email: "",
  phone: "",
  location: "",
  summary: "Builds things.",
  skills: ["Python", "SQL"],
  experience: [
    {
      id: "r1",
      company: "Acme",
      title: "Engineer",
      location: "",
      start: "2020",
      end: "Present",
      bullets: [
        { id: "b1", text: "Led company rollout." },
        { id: "b2", text: "Built platform APIs." },
      ],
      teams: [
        {
          id: "r1-team1",
          name: "Platform",
          title: "",
          location: "",
          start: "",
          end: "",
          bulletIds: ["b2"],
        },
      ],
    },
    {
      id: "r2",
      company: "Empty Co",
      title: "Intern",
      location: "",
      start: "2019",
      end: "2019",
      bullets: [],
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Side project",
      role: "",
      location: "",
      start: "",
      end: "",
      bullets: [{ id: "b3", text: "Shipped a CLI." }],
    },
  ],
  education: [],
  additionalSections: [
    {
      id: "extra1",
      kind: "awards",
      title: "Awards",
      items: [
        {
          id: "extra1-1",
          heading: "Prize",
          subheading: "",
          location: "",
          start: "",
          end: "",
          bullets: [{ id: "b4", text: "Won a prize." }],
        },
      ],
    },
  ],
};

const job = { title: "Backend Engineer", requiredKeywords: ["Kubernetes"] };
const report = {
  overallBefore: 50,
  overallAfter: 70,
  categoriesBefore: [],
  categoriesAfter: [],
  missingKeywords: ["Kubernetes"],
  presentKeywords: [],
  stuffingWarnings: [],
};

test("chunk plan skips entries with no bullets and adds extras only in preserve mode", () => {
  assert.deepEqual(planRewriteChunks(resume, "optimize").map(chunkKey), [
    "global",
    "role:r1",
    "project:p1",
  ]);
  assert.deepEqual(planRewriteChunks(resume, "preserve").map(chunkKey), [
    "global",
    "role:r1",
    "project:p1",
    "additional:extra1",
  ]);
});

test("entry prompts carry only their own entry and locked ids", () => {
  const prompt = buildChunkPrompt({
    chunk: { kind: "role", id: "r1" },
    resume,
    job,
    report,
    structureMode: "optimize",
    lockedContentIds: ["b2", "b3", "summary"],
    baselineOptimization: null,
  });
  assert.match(prompt.user, /"company":"Acme"/);
  assert.doesNotMatch(prompt.user, /Side project/);
  assert.match(prompt.user, /\["b2"\]/);
  assert.match(prompt.user, /Kubernetes/);
  assert.ok(prompt.maxTokens < 1200);

  const global = buildChunkPrompt({
    chunk: { kind: "global" },
    resume,
    job,
    report,
    structureMode: "optimize",
    lockedContentIds: ["b2", "b3", "summary"],
    baselineOptimization: null,
  });
  assert.match(global.user, /\["summary"\]/);
  assert.match(global.system, /sectionOrder/);
});

test("entry prompts carry the keyword budget left by the rest of the document", () => {
  const dense = {
    ...resume,
    skills: ["Python", "Python 3", "Python scripting", "SQL"],
    summary: "Python developer who also writes Go.",
  };
  const prompt = buildChunkPrompt({
    chunk: { kind: "project", id: "p1" },
    resume: dense,
    job: { ...job, requiredKeywords: ["Python", "Go", "Kubernetes"] },
    report,
    structureMode: "optimize",
    lockedContentIds: [],
    baselineOptimization: null,
  });
  // Python is already at the cap (4) elsewhere and this entry has none: blocked.
  assert.match(prompt.user, /Do NOT add these terms across this entry: \["Python"\]/);
  // Go: 1 in the source leaves 3 of slack over 3 chunks -> 1 each. Kubernetes
  // is absent: 4 of slack over 3 chunks -> 1 each.
  assert.match(prompt.user, /Maximum mentions across this entry, per term: \{"Go":1,"Kubernetes":1\}/);

  // The global chunk gets the same budget for the summary and headline.
  const global = buildChunkPrompt({
    chunk: { kind: "global" },
    resume: dense,
    job: { ...job, requiredKeywords: ["Python"] },
    report,
    structureMode: "optimize",
    lockedContentIds: [],
    baselineOptimization: null,
  });
  // The source summary already says Python once, so the rewrite may keep it.
  assert.match(global.user, /Maximum mentions in the summary or headline, per term: \{"Python":1\}/);

  // A posting with no keywords has nothing to budget.
  const relaxed = buildChunkPrompt({
    chunk: { kind: "project", id: "p1" },
    resume,
    job: { ...job, requiredKeywords: [] },
    report,
    structureMode: "optimize",
    lockedContentIds: [],
    baselineOptimization: null,
  });
  assert.doesNotMatch(relaxed.user, /Keyword density budget/);
});

test("assembled chunks normalize into a whole optimization with source entry ids", () => {
  const results = new Map([
    [
      "global",
      { summary: "Backend engineer.", title: "Backend Engineer", skills: ["SQL", "Python"], sectionOrder: ["experience"] },
    ],
    [
      "role:r1",
      {
        id: "WRONG",
        bullets: [
          { id: "b1", text: "Led rollout.", evidence: ["b1"], matchedKeywords: [], rationale: "" },
          { id: "b2", text: "Built APIs.", evidence: ["b2"], matchedKeywords: [], rationale: "" },
        ],
      },
    ],
    [
      "project:p1",
      { id: "p1", bullets: [{ id: "b3", text: "Shipped CLI.", evidence: ["b3"], matchedKeywords: [], rationale: "" }] },
    ],
  ]);
  const opt = normalizeOptimization(assembleOptimization(resume, "optimize", results));
  assert.equal(opt.title, "Backend Engineer");
  assert.deepEqual(opt.roles.map((role) => role.id), ["r1", "r2"]);
  assert.deepEqual(opt.roles[1].bullets, []);
  assert.equal(opt.roles[0].bullets[1].text, "Built APIs.");
  assert.equal(opt.projects[0].bullets[0].text, "Shipped CLI.");
  assert.deepEqual(opt.sectionOrder, ["experience"]);
  assert.deepEqual(opt.additionalSections, []);

  const preserved = normalizeOptimization(
    assembleOptimization(
      resume,
      "preserve",
      new Map([
        ...results,
        ["additional:extra1", { id: "extra1", items: [{ id: "extra1-1", bullets: [{ id: "b4", text: "Won.", evidence: ["b4"] }] }] }],
      ]),
    ),
  );
  assert.equal(preserved.additionalSections[0].items[0].bullets[0].text, "Won.");
});

test("issues are routed to the chunk that owns the id they name", () => {
  const chunks = planRewriteChunks(resume, "preserve");
  const candidate = normalizeOptimization({
    summary: "Kubernetes Kubernetes.",
    title: "",
    skills: ["Python", "SQL"],
    roles: [
      { id: "r1", bullets: [{ id: "b1", text: "Ran Kubernetes.", evidence: ["b1"] }, { id: "b2", text: "APIs.", evidence: ["b2"] }] },
      { id: "r2", bullets: [] },
    ],
    projects: [{ id: "p1", bullets: [{ id: "b3", text: "CLI.", evidence: ["b3"] }] }],
  });
  const routed = chunksForIssues({
    resume,
    candidate,
    chunks,
    issues: [
      "b2 introduces an unsupported number: 40%.",
      'roles "r1": expected 2 bullets (one-to-one rewrite), got 1',
      "Semantic grounding failed for b3: claims a launch the source never mentions.",
      "extra1 items were added, removed, or reordered.",
      'Skill "Go" is not grounded in the source resume.',
      'keyword "Kubernetes": repeated 4 times (the source resume has 0) — state it once',
      "Bullet id (empty) is missing or duplicated.",
    ],
  });
  assert.deepEqual(routed.get("role:r1"), [
    "b2 introduces an unsupported number: 40%.",
    'roles "r1": expected 2 bullets (one-to-one rewrite), got 1',
    'keyword "Kubernetes": repeated 4 times (the source resume has 0) — state it once',
    "Bullet id (empty) is missing or duplicated.",
  ]);
  assert.deepEqual(routed.get("project:p1"), [
    "Semantic grounding failed for b3: claims a launch the source never mentions.",
    "Bullet id (empty) is missing or duplicated.",
  ]);
  assert.deepEqual(routed.get("additional:extra1"), [
    "extra1 items were added, removed, or reordered.",
    "Bullet id (empty) is missing or duplicated.",
  ]);
  assert.deepEqual(routed.get("global"), [
    'Skill "Go" is not grounded in the source resume.',
    'keyword "Kubernetes": repeated 4 times (the source resume has 0) — state it once',
  ]);
  // "b1" must not match inside "b10"-style ids or the team id.
  assert.equal(
    chunksForIssues({ resume, candidate, chunks, issues: ["r1-team1 heading changed."] }).has("role:r1"),
    true,
  );
});

test("mapWithConcurrency preserves order and caps parallelism", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    active -= 1;
    return ms * 2;
  });
  assert.deepEqual(out, [60, 20, 40, 10, 30]);
  assert.equal(peak, 2);
});
