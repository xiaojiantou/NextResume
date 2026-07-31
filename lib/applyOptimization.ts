// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Materializes an Optimization back into Resume shape so the optimized
// content can be re-scored by /api/analyze with the exact same rubric the
// original resume was scored with. Presentation-only concerns (photo, style,
// section order) pass through untouched.
import type { Optimization, Resume } from "./types";

export function applyOptimizationToResume(
  resume: Resume,
  optimization: Optimization,
  options?: { includeSummary?: boolean },
): Resume {
  return {
    ...resume,
    title: optimization.title || resume.title,
    summary:
      options?.includeSummary === false
        ? resume.summary
        : optimization.summary || resume.summary,
    skills:
      optimization.skills && optimization.skills.length > 0
        ? optimization.skills
        : resume.skills,
    experience: resume.experience.map((role) => {
      const opt = optimization.roles.find((r) => r.id === role.id);
      if (!opt?.bullets.length) return role;
      return {
        ...role,
        bullets: opt.bullets.map((b) => ({ id: b.id, text: b.text })),
      };
    }),
    projects: (resume.projects ?? []).map((project) => {
      const opt = optimization.projects?.find((p) => p.id === project.id);
      if (!opt?.bullets.length) return project;
      return {
        ...project,
        bullets: opt.bullets.map((b) => ({ id: b.id, text: b.text })),
      };
    }),
  };
}
