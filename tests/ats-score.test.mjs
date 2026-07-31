import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_KEYWORD_REPEATS,
  detectStuffing,
  resumeToText,
  scoreResume,
  titleTokens,
} from "../lib/atsScore.ts";

const job = {
  title: "Intern: AI Engineering",
  company: "Volvo Group",
  seniority: "Internship",
  requiredKeywords: [
    "Python", "PyTorch", "machine learning", "Docker", "CI/CD",
    "AWS", "data pipeline", "REST API",
  ],
  niceToHaveKeywords: ["Kubernetes", "vector database"],
  responsibilities: ["Build and deploy machine learning models"],
};

function resume(overrides = {}) {
  return {
    name: "Kunyi Shi",
    title: "Software Engineering Student",
    email: "k@example.com",
    phone: "555-0100",
    location: "Boston, MA",
    summary: "",
    skills: ["Python", "Java", "SQL"],
    experience: [
      {
        id: "r1",
        company: "TechCorp",
        title: "Software Engineering Intern",
        location: "Boston, MA",
        start: "2025-06",
        end: "2025-09",
        bullets: [
          { id: "b1", text: "Worked on internal dashboard tools." },
          { id: "b2", text: "Helped with a script that processed data files." },
        ],
      },
    ],
    projects: [],
    education: [{ school: "Northeastern University", degree: "M.S in Computer Science", year: "2026" }],
    ...overrides,
  };
}

// The whole point of the rewrite: the number must not move on its own.
test("scoring is deterministic across repeated runs", () => {
  const r = resume();
  const first = scoreResume(r, job);
  for (let i = 0; i < 50; i++) {
    const again = scoreResume(r, job);
    assert.equal(again.overall, first.overall);
    assert.deepEqual(
      again.categories.map((c) => c.score),
      first.categories.map((c) => c.score),
    );
  }
});

test("a stronger resume scores higher than a weak one", () => {
  const weak = scoreResume(resume(), job);
  const strong = scoreResume(
    resume({
      title: "AI Engineering Intern",
      summary: "Machine learning engineer working in Python and PyTorch.",
      skills: ["Python", "PyTorch", "machine learning", "Docker", "AWS", "REST API", "CI/CD", "data pipeline"],
      experience: [
        {
          id: "r1",
          company: "TechCorp",
          title: "Machine Learning Intern",
          location: "Boston, MA",
          start: "2025-06",
          end: "2025-09",
          bullets: [
            { id: "b1", text: "Built a PyTorch classification service handling 12000 predictions per day." },
            { id: "b2", text: "Shipped a Python data pipeline on AWS that cut preprocessing time by 60%." },
          ],
        },
      ],
    }),
    job,
  );
  assert.ok(
    strong.overall > weak.overall + 20,
    `expected a large lift, got ${weak.overall} -> ${strong.overall}`,
  );
});

test("every category responds to the thing it measures", () => {
  const before = scoreResume(resume(), job);
  const byLabel = (s, label) => s.categories.find((c) => c.label === label).score;

  // Title match: only the headline changes.
  const titled = scoreResume(resume({ title: "AI Engineering Intern" }), job);
  assert.ok(byLabel(titled, "Title match") > byLabel(before, "Title match"));

  // Action verbs: same facts, stronger openers.
  const verbs = scoreResume(
    resume({
      experience: [
        {
          ...resume().experience[0],
          bullets: [
            { id: "b1", text: "Built internal dashboard tools." },
            { id: "b2", text: "Shipped a script that processed data files." },
          ],
        },
      ],
    }),
    job,
  );
  assert.ok(byLabel(verbs, "Action verbs") > byLabel(before, "Action verbs"));

  // Quantified impact: same facts, numbers added.
  const quantified = scoreResume(
    resume({
      experience: [
        {
          ...resume().experience[0],
          bullets: [
            { id: "b1", text: "Worked on 4 internal dashboard tools." },
            { id: "b2", text: "Helped with a script that processed 200 data files." },
          ],
        },
      ],
    }),
    job,
  );
  assert.ok(byLabel(quantified, "Quantified impact") > byLabel(before, "Quantified impact"));
});

test("title match tolerates word order and seniority wording", () => {
  assert.deepEqual(titleTokens("Intern: AI Engineering"), titleTokens("AI Engineer"));

  const matched = scoreResume(resume({ title: "AI Engineering Intern" }), job);
  const titleScore = matched.categories.find((c) => c.label === "Title match").score;
  assert.equal(titleScore, 100);
});

test("title match falls back to partial credit below the headline", () => {
  const headlineOnly = scoreResume(resume({ title: "AI Engineer" }), job);
  const buriedInSummary = scoreResume(
    resume({ title: "Software Engineer", summary: "AI engineering student seeking work." }),
    job,
  );
  // No "ai" and no "engineer" anywhere, including the employment history.
  const nowhere = scoreResume(
    resume({
      title: "Barista",
      experience: [{ ...resume().experience[0], title: "Shift Supervisor" }],
    }),
    job,
  );

  const s = (r) => r.categories.find((c) => c.label === "Title match").score;
  assert.equal(s(headlineOnly), 100);
  assert.ok(s(buriedInSummary) > 0 && s(buriedInSummary) < 100);
  assert.equal(s(nowhere), 0);

  // A past job title carrying the role words still earns partial credit, since
  // recruiters' title filters search the whole document.
  const inJobHistory = scoreResume(
    resume({ title: "Barista", experience: [{ ...resume().experience[0], title: "AI Engineer" }] }),
    job,
  );
  assert.ok(s(inJobHistory) > 0 && s(inJobHistory) < 100);
});

test("keyword matching respects word boundaries and separator variants", () => {
  const javaOnly = scoreResume(resume({ skills: ["Java"] }), {
    ...job,
    requiredKeywords: ["JavaScript"],
  });
  assert.deepEqual(javaOnly.missingKeywords, ["JavaScript"]);

  const separators = scoreResume(resume({ skills: ["CI-CD", "data pipelines", "REST APIs"] }), {
    ...job,
    requiredKeywords: ["CI/CD", "data pipeline", "REST API"],
  });
  assert.deepEqual(separators.missingKeywords, []);
});

test("repeating a keyword buys no score", () => {
  const once = resume({
    skills: ["Python", "PyTorch", "machine learning", "Docker", "AWS", "REST API", "CI/CD", "data pipeline"],
  });
  const stuffed = resume({
    skills: once.skills,
    experience: [
      {
        ...once.experience[0],
        bullets: [
          { id: "b1", text: "Python Python Python Python Python Python Python Python work." },
          { id: "b2", text: "Docker Docker Docker Docker Docker Docker Docker deployments." },
        ],
      },
    ],
  });

  const a = scoreResume(once, job);
  const b = scoreResume(stuffed, job);
  const kw = (r) => r.categories.find((c) => c.label === "Keyword match").score;
  assert.equal(kw(a), kw(b), "keyword match must count each keyword once");
  assert.ok(b.overall <= a.overall, "stuffing must never raise the overall score");
});

test("keyword stuffing is detected, penalized, and explained", () => {
  const text = resumeToText(
    resume({
      summary: "Python ".repeat(9),
    }),
  );
  const report = detectStuffing(text, job);

  assert.ok(report.penalty > 0, "expected a penalty");
  assert.ok(report.warnings.length > 0, "expected a user-facing warning");
  assert.equal(report.worst[0].keyword, "Python");
  assert.ok(report.worst[0].count > MAX_KEYWORD_REPEATS);
  assert.ok(report.penalty <= 15, "penalty is capped");
});

test("a clean resume triggers no stuffing warning", () => {
  const report = detectStuffing(resumeToText(resume()), job);
  assert.equal(report.penalty, 0);
  assert.deepEqual(report.warnings, []);
});

// Resumes vary enormously. These pin the shapes that a whitelist-driven
// scorer would have penalized unfairly.
test("strong verbs outside any hardcoded list still count", () => {
  const exotic = scoreResume(
    resume({
      experience: [
        {
          ...resume().experience[0],
          bullets: [
            { id: "b1", text: "Orchestrated a migration across twelve services." },
            { id: "b2", text: "Instrumented the request path end to end." },
            { id: "b3", text: "Pioneered the team's evaluation harness." },
            { id: "b4", text: "Overhauled the release process." },
          ],
        },
      ],
    }),
    job,
  );
  const verbs = exotic.categories.find((c) => c.label === "Action verbs").score;
  assert.equal(verbs, 100, "regular past-tense openers must all count as strong");
});

test("a senior resume with no education section is not penalized", () => {
  const senior = resume({ education: [] });
  const fmt = scoreResume(senior, job).categories.find((c) => c.label === "ATS formatting").score;
  assert.equal(fmt, 100);
});

test("a student resume with projects but no jobs is not penalized", () => {
  const student = resume({
    experience: [],
    projects: [
      {
        id: "p1", name: "Compiler", role: "Author", location: "", start: "", end: "",
        bullets: [{ id: "pb1", text: "Built a bytecode VM in Python." }],
      },
    ],
  });
  const fmt = scoreResume(student, job).categories.find((c) => c.label === "ATS formatting").score;
  assert.equal(fmt, 100);
});

test("weak openers are still caught", () => {
  const weak = scoreResume(
    resume({
      experience: [
        {
          ...resume().experience[0],
          bullets: [
            { id: "b1", text: "Responsible for the billing service." },
            { id: "b2", text: "Involved in a migration project." },
          ],
        },
      ],
    }),
    job,
  );
  assert.equal(weak.categories.find((c) => c.label === "Action verbs").score, 0);
});

test("resumeToText reaches every section an ATS would index", () => {
  const text = resumeToText(
    resume({
      skillGroups: [{ label: "Languages", skills: ["Rust"] }],
      projects: [
        {
          id: "p1", name: "SideProject", role: "Author", location: "", start: "", end: "",
          bullets: [{ id: "pb1", text: "Built a Kubernetes operator." }],
        },
      ],
      additionalSections: [
        {
          id: "a1", kind: "awards", title: "Awards",
          items: [
            {
              id: "ai1", heading: "Best Paper", subheading: "", location: "", start: "", end: "",
              bullets: [{ id: "ab1", text: "Recognized for vector database research." }],
            },
          ],
        },
      ],
    }),
  );

  for (const needle of ["rust", "kubernetes operator", "vector database", "northeastern"]) {
    assert.ok(text.includes(needle), `resumeToText dropped: ${needle}`);
  }
});
