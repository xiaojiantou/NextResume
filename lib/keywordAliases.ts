// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Surface-form equivalences for keyword matching.
//
// Scoring matches keywords literally (see lib/atsScore.ts), which makes a
// spelling difference indistinguishable from a missing skill: a resume saying
// "K8s" scored zero against a posting saying "Kubernetes", and the advice text
// then told the candidate to add a tool they already had.
//
// THE RULE FOR THIS FILE: a group is the SAME THING SPELLED DIFFERENTLY.
// It is not a similarity table. Meta's Tupperware and Kubernetes are both
// container orchestration, but they are different products, and a recruiter
// filtering on "Kubernetes" will not surface a Tupperware resume. Scoring them
// as equal would inflate our number without moving the outcome it predicts,
// and no rewrite may put "Kubernetes" on a resume that earned Tupperware.
// Transferable-but-different belongs in advice to the user, never in here.
//
// Deliberately excluded as too ambiguous for word-boundary matching, even
// though they are genuine aliases: "JS"/"TS" (match inside "Node.js" and
// friends, since "." is not an alphanumeric boundary character), "Go" (ordinary
// English), "CV" (curriculum vitae on a resume), "TF" (TensorFlow vs
// Terraform).
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  // Cloud and infrastructure
  ["kubernetes", "k8s"],
  ["amazon web services", "aws"],
  ["google cloud platform", "google cloud", "gcp"],
  ["microsoft azure", "azure"],
  ["infrastructure as code", "iac"],

  // Data stores
  ["postgresql", "postgres"],
  ["mongodb", "mongo"],
  ["microsoft sql server", "sql server", "mssql"],
  ["elasticsearch", "elastic search"],
  ["structured query language", "sql"],

  // Languages and runtimes
  ["javascript", "ecmascript"],
  ["node.js", "nodejs"],
  ["c#", "c sharp", "csharp"],
  ["objective-c", "objc"],

  // Web
  ["react.js", "reactjs", "react"],
  ["next.js", "nextjs"],
  ["vue.js", "vuejs", "vue"],
  ["rest api", "restful api", "restful web service"],
  ["application programming interface", "api"],
  ["user interface", "ui"],
  ["user experience", "ux"],

  // Machine learning
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["natural language processing", "nlp"],
  ["large language model", "llm"],
  ["scikit-learn", "sklearn"],
  ["pytorch", "torch"],

  // Practices
  ["object oriented programming", "oop"],
  ["test driven development", "tdd"],
  ["software development kit", "sdk"],
  ["continuous integration", "continuous delivery", "ci/cd"],
];

const SURFACE_FORMS = new Map<string, readonly string[]>();
for (const group of ALIAS_GROUPS) {
  for (const form of group) SURFACE_FORMS.set(form, group);
}

/**
 * Every spelling that counts as `keyword`, including `keyword` itself. Returns
 * a single-element list when the term has no registered aliases.
 *
 * Colon-aware because jobKeywords' heading detector compares occurrences of
 * "<keyword>" against occurrences of "<keyword>:" — expanding only one side of
 * that comparison would quietly stop it detecting headings.
 */
export function keywordSurfaceForms(keyword: string): string[] {
  const cleaned = keyword.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const trailingColon = cleaned.endsWith(":");
  const bare = trailingColon ? cleaned.slice(0, -1).trim() : cleaned;

  const group = SURFACE_FORMS.get(bare);
  if (!group) return [keyword];
  return trailingColon ? group.map((form) => `${form}:`) : [...group];
}
