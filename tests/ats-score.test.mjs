import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_KEYWORD_REPEATS,
  countOccurrences,
  detectStuffing,
  resumeToText,
  scoreResume,
  titleTokens,
} from "../lib/atsScore.ts";
import { sanitizeKeywords } from "../lib/jobKeywords.ts";

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

test("keyword matching accepts registered spelling variants in both directions", () => {
  // A spelling difference used to be indistinguishable from a missing skill:
  // "K8s" on the resume scored zero against a posting saying "Kubernetes", and
  // the advice then told the candidate to add a tool they already had.
  assert.ok(countOccurrences("ran workloads on k8s", "Kubernetes") > 0);
  assert.ok(countOccurrences("ran workloads on kubernetes", "K8s") > 0);
  assert.ok(countOccurrences("tuned postgres replicas", "PostgreSQL") > 0);
  assert.ok(countOccurrences("built services in nodejs", "Node.js") > 0);
  assert.ok(countOccurrences("shipped ml pipelines", "machine learning") > 0);
  assert.ok(countOccurrences("deployed on gcp", "Google Cloud Platform") > 0);
});

test("aliases never loosen word boundaries or admit mere similarity", () => {
  // "ML" is a registered alias of machine learning, but it must not be found
  // inside HTML or XML.
  assert.equal(countOccurrences("wrote html and xml parsers", "machine learning"), 0);
  assert.equal(countOccurrences("built a JavaScript runtime", "Java"), 0);
  // The similarity case this table deliberately refuses: Tupperware is Meta's
  // container orchestration platform, but a recruiter filtering on Kubernetes
  // will not surface it, so scoring it as a match would inflate our number
  // without moving the outcome the number exists to predict.
  assert.equal(countOccurrences("scaled services on Tupperware", "Kubernetes"), 0);
  // A term with no registered variants still matches only itself.
  assert.equal(countOccurrences("used Terraform", "Terraform"), 1);
  assert.equal(countOccurrences("used Terraform", "Pulumi"), 0);
});

test("alias expansion raises keyword match on a resume that already had the skill", () => {
  const aliasJob = {
    ...job,
    requiredKeywords: ["Kubernetes", "PostgreSQL"],
    niceToHaveKeywords: [],
  };
  const before = scoreResume(resume(), aliasJob).missingKeywords;
  assert.deepEqual(before, ["Kubernetes", "PostgreSQL"]);

  const withAliases = resume({
    skills: ["K8s", "Postgres"],
  });
  const after = scoreResume(withAliases, aliasJob);
  assert.deepEqual(after.missingKeywords, []);
});

test("heading detection still fires for a keyword that has aliases", () => {
  // countOccurrences expands both sides of the heading comparison, so a
  // posting whose only mention of a term is a bolded label stays filtered.
  const posting = "Machine Learning:\nBuild models with PyTorch and deploy them.";
  assert.deepEqual(sanitizeKeywords(["Machine Learning", "PyTorch"], posting), ["PyTorch"]);
});

// --- rewrite stuffing validation (lib/optimizeContract.ts) -----------------
// Regression for the 2026-08-31 failure: a source resume that already used a
// JD keyword more than MAX_KEYWORD_REPEATS times (skills line + tech stacks
// are kept verbatim) made every preserve-mode rewrite fail validation — three
// attempts, then a 422 the user could not fix. Pre-existing density belongs in
// the analysis warnings, not in the rewrite's rejection criteria.

const { validateOptimization } = await import("../lib/optimizeContract.ts");

function optimizationWith(r, texts) {
  return {
    summary: r.summary,
    title: r.title,
    skills: [...r.skills],
    roles: [
      {
        id: "r1",
        bullets: r.experience[0].bullets.map((b, i) => ({
          id: b.id,
          text: texts[i] ?? b.text,
          evidence: [b.id],
          matchedKeywords: [],
          rationale: "",
        })),
      },
    ],
    projects: [],
  };
}

const denseSource = () =>
  resume({
    skills: ["Python", "Java"],
    experience: [
      {
        id: "r1",
        company: "TechCorp",
        title: "Software Engineering Intern",
        location: "Boston, MA",
        start: "2025-06",
        end: "2025-09",
        bullets: [
          { id: "b1", text: "Built Python services; wrote Python tooling and Python tests." },
          { id: "b2", text: "Automated Python deploys with a Python CLI." },
        ],
      },
    ],
  });

test("source-resume keyword density does not fail the rewrite", () => {
  const r = denseSource();
  assert.ok(
    countOccurrences(resumeToText(r), "Python") > MAX_KEYWORD_REPEATS,
    "fixture must already exceed the cap on its own",
  );
  // A rewrite that keeps density exactly where the source had it.
  const issues = validateOptimization(
    r,
    optimizationWith(r, [
      "Shipped Python services; wrote Python tooling and Python tests.",
      "Automated Python deploys with a Python CLI.",
    ]),
    job,
  ).filter((i) => i.startsWith("keyword"));
  assert.deepEqual(issues, []);
});

test("a rewrite that adds density beyond the source still fails", () => {
  const r = denseSource();
  const issues = validateOptimization(
    r,
    optimizationWith(r, [
      "Shipped Python services in Python; wrote Python tooling and Python tests in Python.",
      "Automated Python deploys with a Python CLI for Python jobs.",
    ]),
    job,
  ).filter((i) => i.startsWith("keyword"));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /"Python"/);
});

test("a clean source still gets the absolute stuffing cap", () => {
  const r = resume(); // one "Python" in skills, none in bullets
  const issues = validateOptimization(
    r,
    optimizationWith(r, [
      "Built Python dashboards with Python and Python pipelines.",
      "Wrote Python scripts and Python data jobs.",
    ]),
    job,
  ).filter((i) => i.startsWith("keyword"));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /"Python"/);
});
