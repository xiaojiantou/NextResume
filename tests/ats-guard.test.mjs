import assert from "node:assert/strict";
import test from "node:test";
import { guardAtsRegression } from "../lib/atsGuard.ts";
import { applyOptimizationToResume } from "../lib/applyOptimization.ts";
import { scoreResume } from "../lib/atsScore.ts";

const resume = {
  name: "Candidate",
  title: "AI Product Engineer",
  email: "c@example.com",
  phone: "555",
  location: "",
  links: [],
  summary: "AI product engineer shipping LangGraph agents and Kubernetes deployments.",
  skills: ["Python", "TypeScript"],
  experience: [
    {
      id: "r1",
      company: "Acme",
      title: "Engineer",
      location: "",
      start: "2022",
      end: "Present",
      bullets: [
        { id: "b1", text: "Built a Terraform pipeline that cut deploy time by 40%." },
        { id: "b2", text: "Owned on-call for the payments domain." },
      ],
    },
  ],
  projects: [],
  education: [],
};
const job = {
  title: "AI Product Engineer",
  company: "Brain Co.",
  seniority: "",
  requiredKeywords: ["LangGraph", "Kubernetes", "Terraform", "Python"],
  niceToHaveKeywords: [],
  responsibilities: [],
};
const bullet = (id, text) => ({ id, text, evidence: [id], matchedKeywords: [], rationale: "" });

test("restores exactly the source fields whose job keywords the rewrite dropped", () => {
  const optimization = {
    title: "AI Product Engineer",
    summary: "Engineer shipping agents and container deployments.",
    skills: ["Python", "TypeScript"],
    roles: [{ id: "r1", bullets: [bullet("b1", "Built an infrastructure pipeline that cut deploy time by 40%."), bullet("b2", "Ran on-call for the payments domain.")] }],
    projects: [],
  };
  const { optimization: guarded, restored } = guardAtsRegression({ resume, optimization, job });
  assert.deepEqual(restored.map((item) => item.id).sort(), ["b1", "summary"]);
  assert.equal(guarded.roles[0].bullets[0].text, resume.experience[0].bullets[0].text);
  assert.equal(guarded.roles[0].bullets[1].text, "Ran on-call for the payments domain.");
  assert.equal(guarded.summary, resume.summary);
  const before = scoreResume(resume, job).overall;
  const after = scoreResume(applyOptimizationToResume(resume, guarded), job).overall;
  assert.ok(after >= before, `${after} < ${before}`);
});

test("keeps a headline that drifted off the posting only if it matches at least as well", () => {
  const optimization = {
    title: "Product Engineer",
    summary: resume.summary,
    skills: resume.skills,
    roles: [{ id: "r1", bullets: [bullet("b1", resume.experience[0].bullets[0].text), bullet("b2", resume.experience[0].bullets[1].text)] }],
    projects: [],
  };
  const drifted = guardAtsRegression({ resume, optimization, job });
  assert.deepEqual(drifted.restored.map((item) => item.id), ["title"]);
  assert.equal(drifted.optimization.title, "AI Product Engineer");

  const retitled = guardAtsRegression({ resume, optimization: { ...optimization, title: "Senior AI Product Engineer" }, job });
  assert.deepEqual(retitled.restored, []);
});

test("locked content and rewrites that keep every keyword are left alone", () => {
  const optimization = {
    title: "AI Product Engineer",
    summary: "Ships LangGraph agents on Kubernetes.",
    skills: resume.skills,
    roles: [{ id: "r1", bullets: [bullet("b1", "Cut deploy time by 40% with a Terraform pipeline."), bullet("b2", "Owned on-call.")] }],
    projects: [],
  };
  assert.deepEqual(guardAtsRegression({ resume, optimization, job }).restored, []);

  const dropped = { ...optimization, roles: [{ id: "r1", bullets: [bullet("b1", "Cut deploy time by 40%."), bullet("b2", "Owned on-call.")] }] };
  const locked = guardAtsRegression({ resume, optimization: dropped, job, lockedContentIds: ["b1"] });
  assert.deepEqual(locked.restored, []);
  assert.equal(locked.optimization.roles[0].bullets[0].text, "Cut deploy time by 40%.");
});
